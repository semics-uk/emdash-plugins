// R27 check on staging (T111): Cloudflare's own CPU figure for one route next to the T007 harness's
// local figure for the same route. The nightly sends a burst of requests to the route, waits for the
// Workers analytics to catch up, and reads the CPU time quantiles of the staging Worker for that window
// (GraphQL `workersInvocationsAdaptive`, microseconds). The burst dominates the window; the minute cron
// adds one invocation a minute.
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node staging/cpu.mjs <baseURL> \
//     [--route /_emdash/api/plugins/semics-events/public/events] [--requests 50] [--local-ms <T007 figure>]
//
// Fails when Cloudflare's p99 is over the 50 ms limit, or when the local figure is not conservative
// (lower than Cloudflare's p99), which would overturn R27.
import { fileURLToPath } from "node:url";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
export const CPU_LIMIT_MS = 50;

export function cpuQuery({ accountId, scriptName, since, until }) {
	return {
		query: `query StagingCpu($accountTag: string!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 10, filter: $filter) {
        sum { requests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
    }
  }
}`,
		variables: { accountTag: accountId, filter: { scriptName, datetime_geq: since, datetime_leq: until } },
	};
}

/** `{ requests, p50Ms, p99Ms }` from the GraphQL answer (CPU time comes in microseconds). */
export function parseCpu(response) {
	if (response?.errors?.length) throw new Error(response.errors.map((e) => e.message).join("; "));
	const rows = response?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
	if (!rows.length) throw new Error("no invocations in the window yet");
	const requests = rows.reduce((n, r) => n + (r.sum?.requests ?? 0), 0);
	const max = (key) => Math.max(...rows.map((r) => r.quantiles?.[key] ?? 0));
	return { requests, p50Ms: max("cpuTimeP50") / 1000, p99Ms: max("cpuTimeP99") / 1000 };
}

/** R27: the local figure should be at or above Cloudflare's p99 (conservative), and p99 within the limit. */
export function compareCpu({ localMs, cloudflare }) {
	const ratio = Math.round((localMs / cloudflare.p99Ms) * 100) / 100;
	const withinLimit = cloudflare.p99Ms <= CPU_LIMIT_MS;
	const conservative = ratio >= 1;
	return { localMs, ...cloudflare, ratio, withinLimit, conservative, ok: withinLimit && conservative };
}

async function main(argv, env) {
	const baseURL = argv.find((a) => !a.startsWith("--") && !/^\d/.test(a) && a.startsWith("http"));
	const opt = (name, fallback) => {
		const at = argv.indexOf(`--${name}`);
		return at >= 0 ? argv[at + 1] : fallback;
	};
	if (!baseURL) throw new Error("usage: node staging/cpu.mjs <baseURL> [--route …] [--requests 50] [--local-ms n]");
	const route = opt("route", "/_emdash/api/plugins/semics-events/public/events");
	const requests = Number(opt("requests", "50"));
	const localMs = Number(opt("local-ms", String(CPU_LIMIT_MS)));
	const scriptName = opt("script", "semics-staging-playground");
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
		throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed to read the Workers analytics");
	}
	const since = new Date().toISOString();
	for (let i = 0; i < requests; i++) {
		const res = await fetch(new URL(route, baseURL));
		if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
		await res.arrayBuffer();
	}
	let cloudflare;
	for (let attempt = 0; attempt < 10; attempt++) {
		await new Promise((r) => setTimeout(r, 30_000)); // analytics lag
		const res = await fetch(GRAPHQL, {
			method: "POST",
			headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
			body: JSON.stringify(
				cpuQuery({ accountId: env.CLOUDFLARE_ACCOUNT_ID, scriptName, since, until: new Date().toISOString() }),
			),
		});
		try {
			cloudflare = parseCpu(await res.json());
			if (cloudflare.requests >= requests) break;
		} catch (error) {
			if (attempt === 9) throw error;
		}
	}
	const verdict = compareCpu({ localMs, cloudflare });
	console.log(JSON.stringify({ route, ...verdict }));
	return verdict.ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await main(process.argv.slice(2), process.env)) ? 0 : 1);
}
