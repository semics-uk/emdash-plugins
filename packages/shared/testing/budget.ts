/**
 * T007 budget harness (test-only: never import this from runtime code).
 *
 * Counts the bridge calls a sandboxed plugin makes and the CPU time it uses per invocation, so
 * route and cron tests can assert the platform limits (EV-NFR-01, EV-NFR-02, ES-NFR-01) until
 * Cloudflare staging measures them for real (T110).
 *
 * How it hooks in: the @emdash-cms/plugin-test hosts run the plugin through EmDash's Cloudflare
 * sandbox runner, which loads it with the Worker Loader binding `env.LOADER`. The harness wraps
 * that binding once per test isolate:
 *
 * - each plugin worker it loads gets an extra main module that subclasses the plugin entrypoint
 *   and hands the plugin a recording proxy of its `BRIDGE` binding, created per invocation, so
 *   concurrent invocations never share a call list. It reports the calls and timings back with
 *   the result. The plugin code and the bridge itself are untouched.
 * - on the host side, the stub returned to the runner unwraps that report, so the runner (and the
 *   test) sees exactly the value or error it would have seen without the harness. Reports are
 *   attributed to the `measure()` call they ran under via AsyncLocalStorage.
 *
 * CPU figure: time the invocation spent running inside the sandbox minus the time it was waiting
 * on bridge calls. It is a local proxy for Cloudflare's CPU-time limit, not the real meter.
 */

/** One round trip from the sandbox to the host bridge. */
export interface BridgeCall {
	/** Bridge area: storage, kv, settings, content, http, email, log, cron, media, ... */
	kind: string;
	/** Operation within the area: get, put, getMany, fetch, send, info, ... */
	method: string;
	/** Storage or content collection, when the call names one. */
	collection?: string;
	/** Storage or content id, or kv/settings key, when the call names one. */
	key?: string;
}

/** Usage of one sandbox invocation (one route or hook call). */
export interface InvocationUsage {
	calls: BridgeCall[];
	/** Time running in the sandbox, excluding time spent waiting on the bridge. */
	cpuMs: number;
	/** Time from entering the sandbox entrypoint to leaving it, bridge waits included. */
	rawCpuMs: number;
}

export interface BudgetResult<T = unknown> {
	label: string;
	/** False when the measured function threw; reading `value` then rethrows the error. */
	ok: boolean;
	readonly value: T;
	error?: unknown;
	/** Every bridge call made, in order, across all invocations. */
	calls: BridgeCall[];
	invocations: InvocationUsage[];
	/** Sum of `cpuMs` over the invocations. */
	cpuMs: number;
	/** Sum of `rawCpuMs` over the invocations. */
	rawCpuMs: number;
	/** Host wall-clock time of the whole measurement. */
	wallMs: number;
}

export interface BudgetLimits {
	/** Maximum bridge calls per invocation. */
	calls?: number;
	/** Maximum CPU ms per invocation. */
	cpuMs?: number;
}

/** Platform limits per invocation: Worker Loader's 10 subrequests and 50 ms CPU (EV-NFR-01/02). */
export const PLATFORM_BUDGET = { calls: 10, cpuMs: 50 } as const;

type Invoke = (name: string, input?: never, request?: never) => Promise<unknown>;
interface InvokeTarget {
	invokeRoute: Invoke;
	invokeHook(name: string, event: unknown): Promise<unknown>;
}
/** `createPluginTestHost()` or `createPluginRuntimeTestHost()` (through its `transport`). */
export type BudgetHost = InvokeTarget | { transport: InvokeTarget };

export interface BudgetedHost {
	invokeRoute(name: string, input?: unknown, request?: unknown): Promise<BudgetResult>;
	invokeHook(name: string, event: unknown): Promise<BudgetResult>;
	/** Measure every sandbox invocation `fn` makes (through any host or admin action). */
	measure<T>(label: string, fn: () => Promise<T>): Promise<BudgetResult<T>>;
}

// ---------------------------------------------------------------------------
// Sandbox side: extra main module loaded next to the runner's generated wrapper.
// ---------------------------------------------------------------------------

const BUDGET_MODULE = "semics-budget.js";
const BUDGET_METHOD = "__semicsBudgetInvoke";

const SANDBOX_MODULE = `
import PluginEntrypoint from "plugin.js";

const AREA = /^([a-z]+)([A-Z][A-Za-z]*)?$/;

function describe(name, args) {
	const match = AREA.exec(name);
	const kind = match ? match[1] : name;
	let method = match && match[2] ? match[2][0].toLowerCase() + match[2].slice(1) : "call";
	if (kind === "log" && typeof args[0] === "string") method = args[0];
	const call = { kind, method };
	if (kind === "storage" || kind === "content") {
		if (typeof args[0] === "string") call.collection = args[0];
		if (typeof args[1] === "string") call.key = args[1];
	} else if ((kind === "kv" || kind === "settings") && typeof args[0] === "string") {
		call.key = args[0];
	}
	return call;
}

function recorder(bridge, usage) {
	const done = () => {
		usage.inFlight -= 1;
		if (usage.inFlight === 0) usage.waitMs += performance.now() - usage.waitStart;
	};
	return new Proxy(bridge, {
		get(target, prop) {
			if (typeof prop !== "string" || prop === "then") return target[prop];
			return (...args) => {
				usage.calls.push(describe(prop, args));
				if (usage.inFlight === 0) usage.waitStart = performance.now();
				usage.inFlight += 1;
				let pending;
				try {
					pending = Promise.resolve(target[prop](...args));
				} catch (error) {
					done();
					throw error;
				}
				pending.then(done, done);
				return pending;
			};
		},
	});
}

export default class BudgetEntrypoint extends PluginEntrypoint {
	async ${BUDGET_METHOD}(kind, args) {
		const usage = { calls: [], waitMs: 0, inFlight: 0, waitStart: 0 };
		const self = Object.create(this, { env: { value: { ...this.env, BRIDGE: recorder(this.env.BRIDGE, usage) } } });
		const method = kind === "hook" ? PluginEntrypoint.prototype.invokeHook : PluginEntrypoint.prototype.invokeRoute;
		const start = performance.now();
		let value;
		let error;
		let failed = false;
		try {
			value = await method.apply(self, args);
		} catch (caught) {
			failed = true;
			error = caught;
		}
		const rawCpuMs = performance.now() - start;
		return { value, failed, error, calls: usage.calls, rawCpuMs, cpuMs: Math.max(0, rawCpuMs - usage.waitMs) };
	}
}
`;

interface SandboxReport {
	value: unknown;
	failed: boolean;
	error: unknown;
	calls: BridgeCall[];
	cpuMs: number;
	rawCpuMs: number;
}

// ---------------------------------------------------------------------------
// Host side: wrap env.LOADER once per isolate.
// ---------------------------------------------------------------------------

interface WorkerCode {
	mainModule: string;
	modules: Record<string, unknown>;
	[key: string]: unknown;
}
interface Entrypoint {
	invokeRoute(...args: unknown[]): Promise<unknown>;
	invokeHook(...args: unknown[]): Promise<unknown>;
	[BUDGET_METHOD](kind: "route" | "hook", args: unknown[]): Promise<SandboxReport>;
}
interface WorkerStub {
	getEntrypoint(name?: string, options?: unknown): Entrypoint;
}
interface WorkerLoader {
	get(name: string, getCode: () => WorkerCode | Promise<WorkerCode>): WorkerStub;
}
interface Collector {
	push(usage: InvocationUsage): void;
}
interface ContextStore {
	run<R>(store: Collector, fn: () => R): R;
	getStore(): Collector | undefined;
}

let installed: Promise<ContextStore> | undefined;

/** Kept in variables so bundlers and type-checkers leave these workerd modules alone. */
const WORKERS_MODULE = "cloudflare:workers";
const ASYNC_HOOKS_MODULE = "node:async_hooks";

function install(): Promise<ContextStore> {
	installed ??= (async () => {
		const [{ env }, { AsyncLocalStorage }] = (await Promise.all([
			import(/* @vite-ignore */ WORKERS_MODULE),
			import(/* @vite-ignore */ ASYNC_HOOKS_MODULE),
		])) as [{ env: { LOADER?: WorkerLoader } }, { AsyncLocalStorage: new () => ContextStore }];
		const loader = env.LOADER;
		if (!loader) throw new Error("Budget harness needs the LOADER binding: add emdashPluginTest() to vitest.config.ts");
		const context = new AsyncLocalStorage();
		const get = loader.get.bind(loader);
		// Instance property shadows the binding's prototype method for every later lookup.
		Object.defineProperty(loader, "get", {
			configurable: true,
			value(name: string, getCode: () => WorkerCode | Promise<WorkerCode>): WorkerStub {
				const stub = get(`${name}:semics-budget`, async () => instrument(await getCode()));
				return {
					getEntrypoint(entry?: string, options?: unknown) {
						const target = stub.getEntrypoint(entry, options);
						if (entry !== undefined && entry !== "default") return target;
						const wrapped: Partial<Entrypoint> = {
							invokeRoute: (...args: unknown[]) => invoke(context, target, "route", args),
							invokeHook: (...args: unknown[]) => invoke(context, target, "hook", args),
						};
						return new Proxy(target, {
							get: (stubTarget, prop) => wrapped[prop as keyof Entrypoint] ?? Reflect.get(stubTarget, prop),
						});
					},
				};
			},
		});
		return context;
	})();
	return installed;
}

function instrument(code: WorkerCode): WorkerCode {
	return {
		...code,
		mainModule: BUDGET_MODULE,
		modules: { ...code.modules, [BUDGET_MODULE]: { js: SANDBOX_MODULE.replace("plugin.js", code.mainModule) } },
	};
}

async function invoke(context: ContextStore, target: Entrypoint, kind: "route" | "hook", args: unknown[]) {
	const report = await target[BUDGET_METHOD](kind, args);
	context.getStore()?.push({ calls: report.calls, cpuMs: report.cpuMs, rawCpuMs: report.rawCpuMs });
	if (report.failed) throw report.error;
	return report.value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Wrap a plugin test host so each invocation returns its value plus the budget it used. */
export function withBudget(host: BudgetHost): BudgetedHost {
	const transport = "transport" in host ? host.transport : host;
	const measure = async <T>(label: string, fn: () => Promise<T>): Promise<BudgetResult<T>> => {
		const context = await install();
		const invocations: InvocationUsage[] = [];
		const start = performance.now();
		let value: T | undefined;
		let error: unknown;
		let ok = true;
		try {
			value = await context.run({ push: (usage) => invocations.push(usage) }, fn);
		} catch (caught) {
			ok = false;
			error = caught;
		}
		const wallMs = performance.now() - start;
		const sum = (pick: (usage: InvocationUsage) => number) => invocations.reduce((total, u) => total + pick(u), 0);
		return {
			label,
			ok,
			get value(): T {
				if (!ok) throw error;
				return value as T;
			},
			...(ok ? {} : { error }),
			calls: invocations.flatMap((usage) => usage.calls),
			invocations,
			cpuMs: sum((usage) => usage.cpuMs),
			rawCpuMs: sum((usage) => usage.rawCpuMs),
			wallMs,
		};
	};
	return {
		invokeRoute: (name, input, request) =>
			measure(`route "${name}"`, () => transport.invokeRoute(name, input as never, request as never)),
		invokeHook: (name, event) => measure(`hook "${name}"`, () => transport.invokeHook(name, event)),
		measure,
	};
}

function formatCall(call: BridgeCall, index: number): string {
	const parts = [`${call.kind}.${call.method}`, call.collection, call.key].filter((part) => part !== undefined);
	return `  ${String(index + 1).padStart(3)}. ${parts.join(" ")}`;
}

/**
 * Assert every invocation in `result` stayed within `limits` (default: the platform budget).
 * The error names the invocation and lists each bridge call it made.
 */
export function expectWithinBudget(
	result: Pick<BudgetResult, "invocations"> & { label?: string },
	limits: BudgetLimits = PLATFORM_BUDGET,
): void {
	const label = result.label ?? "invocation";
	const problems: string[] = [];
	result.invocations.forEach((usage, index) => {
		const name =
			result.invocations.length > 1 ? `${label} (invocation ${index + 1} of ${result.invocations.length})` : label;
		if (limits.calls !== undefined && usage.calls.length > limits.calls) {
			problems.push(
				`${name} made ${usage.calls.length} bridge calls (limit ${limits.calls}):\n${usage.calls.map(formatCall).join("\n")}`,
			);
		}
		if (limits.cpuMs !== undefined && usage.cpuMs > limits.cpuMs) {
			problems.push(`${name} used CPU ${usage.cpuMs.toFixed(1)} ms (limit ${limits.cpuMs} ms)`);
		}
	});
	if (problems.length > 0) {
		const error = new Error(`Budget exceeded\n${problems.join("\n")}`);
		error.name = "BudgetExceededError";
		throw error;
	}
}
