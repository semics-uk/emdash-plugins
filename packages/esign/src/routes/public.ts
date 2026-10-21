import { toRouteError } from "@semics-tech/shared";
import type { RouteEntry } from "emdash/plugin";

/** The complete v1 public route list (BUILD-PLAN §3.2); part of the frozen trust contract. */
export interface PublicRouteSpec {
	readonly name: string;
	readonly methods: readonly ["POST"] | readonly ["GET"];
	readonly body: "json" | "none";
	readonly maxBytes?: number;
}

const JSON_LIMIT = 64 * 1024;

export const PUBLIC_ROUTES: readonly PublicRouteSpec[] = [
	{ name: "public/envelopes/from-intent", methods: ["POST"], body: "json", maxBytes: 16 * 1024 },
	{ name: "public/session", methods: ["POST"], body: "json", maxBytes: 8 * 1024 },
	{ name: "public/otp/send", methods: ["POST"], body: "json", maxBytes: 8 * 1024 },
	{ name: "public/otp/verify", methods: ["POST"], body: "json", maxBytes: 8 * 1024 },
	{ name: "public/submit", methods: ["POST"], body: "json", maxBytes: 256 * 1024 },
	{ name: "public/decline", methods: ["POST"], body: "json", maxBytes: 8 * 1024 },
	{ name: "public/download", methods: ["GET"], body: "none" },
	{ name: "public/verify", methods: ["POST"], body: "json", maxBytes: 8 * 1024 },
	{ name: "public/receipts/lookup", methods: ["POST"], body: "json", maxBytes: 8 * 1024 },
	{ name: "public/templates/catalog", methods: ["POST"], body: "json", maxBytes: JSON_LIMIT },
	{ name: "public/self-serve/start", methods: ["POST"], body: "json", maxBytes: JSON_LIMIT },
];

/** Placeholder until the owning task lands; errors go through the shared registry. */
async function notImplemented(): Promise<unknown> {
	return toRouteError({ code: "NOT_FOUND" }).body;
}

export function publicRoutes(): Record<string, RouteEntry> {
	const routes: Record<string, RouteEntry> = {};
	for (const spec of PUBLIC_ROUTES) {
		routes[spec.name] = {
			public: true,
			methods: [...spec.methods],
			request: spec.maxBytes === undefined ? { body: spec.body } : { body: spec.body, maxBytes: spec.maxBytes },
			handler: notImplemented,
		};
	}
	return routes;
}
