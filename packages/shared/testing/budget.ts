/**
 * T007 budget harness (test-only; skeleton, not yet observing anything).
 */

export interface BridgeCall {
	kind: string;
	method: string;
	collection?: string;
	key?: string;
}

export interface InvocationUsage {
	calls: BridgeCall[];
	cpuMs: number;
	rawCpuMs: number;
}

export interface BudgetResult<T = unknown> {
	label: string;
	ok: boolean;
	readonly value: T;
	error?: unknown;
	calls: BridgeCall[];
	invocations: InvocationUsage[];
	cpuMs: number;
	rawCpuMs: number;
	wallMs: number;
}

export interface BudgetLimits {
	calls?: number;
	cpuMs?: number;
}

export const PLATFORM_BUDGET = { calls: 10, cpuMs: 50 } as const;

type Invoke = (name: string, ...args: unknown[]) => Promise<unknown>;
export type BudgetHost = { invokeRoute: Invoke; invokeHook: Invoke } | { transport: { invokeRoute: Invoke; invokeHook: Invoke } };

export interface BudgetedHost {
	invokeRoute(name: string, input?: unknown, request?: unknown): Promise<BudgetResult>;
	invokeHook(name: string, event: unknown): Promise<BudgetResult>;
	measure<T>(label: string, fn: () => Promise<T>): Promise<BudgetResult<T>>;
}

export function withBudget(host: BudgetHost): BudgetedHost {
	const transport = "transport" in host ? host.transport : host;
	const measure = async <T>(label: string, fn: () => Promise<T>): Promise<BudgetResult<T>> => {
		const value = await fn();
		return { label, ok: true, value, calls: [], invocations: [], cpuMs: 0, rawCpuMs: 0, wallMs: 0 };
	};
	return {
		invokeRoute: (name, input, request) =>
			measure(`route "${name}"`, () => transport.invokeRoute(name, input ?? {}, request ?? {})),
		invokeHook: (name, event) => measure(`hook "${name}"`, () => transport.invokeHook(name, event)),
		measure,
	};
}

export function expectWithinBudget(_result: BudgetResult, _limits: BudgetLimits = PLATFORM_BUDGET): void {}
