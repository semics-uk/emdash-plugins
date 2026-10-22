import { createPluginRuntimeTestHost, createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { ERROR_CODES } from "@semics-tech/shared";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { CERTIFICATE_WORDING } from "../src/domain/pdf";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";
import { afterEach, describe, expect, it } from "vitest";
import plugin from "../src/plugin";
import { PUBLIC_ROUTES } from "../src/routes/public";
import { COLLECTIONS, STORAGE_DECLARATIONS } from "../src/storage/schema";

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

// BUILD-PLAN §3.2 "Public routes (complete v1 list, part of the trust contract)".
const PRD_PUBLIC_ROUTES: Array<[string, string]> = [
	["public/envelopes/from-intent", "POST"],
	["public/session", "POST"],
	["public/otp/send", "POST"],
	["public/otp/verify", "POST"],
	["public/submit", "POST"],
	["public/decline", "POST"],
	["public/download", "GET"],
	["public/verify", "POST"],
	["public/receipts/lookup", "POST"],
	["public/templates/catalog", "POST"],
	["public/self-serve/start", "POST"],
];

describe("ES manifest: trust contract (T020)", () => {
	it("validates and declares exactly the Free capabilities", async () => {
		host = await createPluginTestHost();
		expect([...host.manifest.capabilities].sort()).toEqual(
			["email:send", "media:bytes:read", "media:read", "network:request"].sort(),
		);
	});

	it("allows outbound HTTP to the Turnstile host only", async () => {
		host = await createPluginTestHost();
		expect(host.manifest.allowedHosts).toEqual(["challenges.cloudflare.com"]);
	});

	it("declares every storage collection with its indexes (ES manifest)", async () => {
		host = await createPluginTestHost();
		expect(Object.keys(host.manifest.storage).sort()).toEqual([...COLLECTIONS].sort());
		for (const name of COLLECTIONS) {
			const declared = host.manifest.storage[name] as { indexes: unknown[]; uniqueIndexes?: unknown[] };
			expect(declared.indexes, name).toEqual([...STORAGE_DECLARATIONS[name].indexes]);
			expect(declared.uniqueIndexes ?? [], name).toEqual([...(STORAGE_DECLARATIONS[name].uniqueIndexes ?? [])]);
		}
	});
});

describe("ES public routes equal the PRD list (T020)", () => {
	it("registers exactly the PRD's public routes, each public and method-restricted", () => {
		const routes = (plugin.routes ?? {}) as Record<string, { public?: boolean; methods?: string[] }>;
		const publicRoutes = Object.entries(routes).filter(([, route]) => route.public === true);
		expect(publicRoutes.map(([name]) => name).sort()).toEqual(PRD_PUBLIC_ROUTES.map(([n]) => n).sort());
		for (const [name, method] of PRD_PUBLIC_ROUTES) {
			expect(routes[name]?.methods, name).toEqual([method]);
		}
	});

	it("declares a bounded body for every route, none for the GET download", () => {
		for (const route of PUBLIC_ROUTES) {
			if (route.methods[0] === "GET") {
				expect(route.body, route.name).toBe("none");
			} else {
				expect(route.body, route.name).toBe("json");
				expect(route.maxBytes, route.name).toBeGreaterThan(0);
				expect(route.maxBytes, route.name).toBeLessThanOrEqual(256 * 1024);
			}
		}
	});

	it("returns a not-implemented error through the shared registry from every stub", async () => {
		host = await createPluginTestHost();
		const implemented = new Set([
			"public/envelopes/from-intent",
			"public/session",
			"public/submit",
			"public/decline",
			"public/download",
			"public/verify",
		]);
		for (const [name] of PRD_PUBLIC_ROUTES.filter(([n]) => !implemented.has(n))) {
			const result = (await host.invokeRoute(name, {})) as { ok: boolean; error: { code: string; message: string } };
			expect(result.ok, name).toBe(false);
			expect(result.error.code, name).toBe("NOT_FOUND");
			expect(result.error.message, name).toBe(ERROR_CODES.NOT_FOUND.message);
		}
	});

	it("has registry codes for the e-sign and protocol errors", () => {
		for (const code of [
			"ENVELOPE_NOT_FOUND",
			"ENVELOPE_CLOSED",
			"SIGNING_TOKEN_INVALID",
			"SIGNING_TOKEN_EXPIRED",
			"TEMPLATE_NOT_FOUND",
			"TOKEN_REPLAYED",
			"RATE_LIMITED",
			"TURNSTILE_FAILED",
		]) {
			expect(Object.hasOwn(ERROR_CODES, code), code).toBe(true);
		}
	});
});

describe("ES settings schema (T020)", () => {
	it("declares the settings the PRD lists, with documented defaults", async () => {
		host = await createPluginTestHost();
		const schema = (host.manifest as unknown as { admin: { settingsSchema: Record<string, Record<string, unknown>> } })
			.admin.settingsSchema;
		expect(Object.keys(schema).sort()).toEqual(
			[
				"consentVersion",
				"consentWording",
				"expiryDays",
				"integrationMasterKey",
				"otpContractTemplates",
				"otpDefault",
				"reminderCadenceDays",
				"retentionPersonalDataMonths",
				"retentionSignedRecordsYears",
				"senderName",
				"turnstileSecretKey",
				"turnstileSiteKey",
			].sort(),
		);
		expect(schema.otpDefault?.default).toBe(false);
		expect(schema.otpContractTemplates?.default).toBe(true);
		expect(schema.retentionPersonalDataMonths?.default).toBe(12);
		expect(schema.retentionSignedRecordsYears?.default).toBe(7);
		expect(schema.integrationMasterKey?.type).toBe("secret");
		expect(schema.turnstileSecretKey?.type).toBe("secret");
		const secrets = Object.entries(schema).filter(([, field]) => field.type === "secret");
		expect(secrets.map(([key]) => key).sort()).toEqual(["integrationMasterKey", "turnstileSecretKey"]);
	});
});

describe("ES-NFR-07 the product never claims more than a simple electronic signature (T034)", () => {
	// eIDAS Art. 25(2) gives only a qualified signature the equivalent effect of a handwritten one.
	const OVERCLAIMS = [/handwritten/i, /same legal effect/i, /qualified/i, /advanced electronic/i, /tamper-?proof/i];

	it("the default consent wording (manifest and code) and the certificate wording make no stronger claim", async () => {
		host = await createPluginTestHost();
		const schema = (host.manifest as unknown as { admin: { settingsSchema: Record<string, Record<string, unknown>> } })
			.admin.settingsSchema;
		expect(schema.consentWording?.default).toBe(DEFAULT_CONSENT_WORDING);
		for (const text of [DEFAULT_CONSENT_WORDING, CERTIFICATE_WORDING]) {
			for (const claim of OVERCLAIMS) expect(text, String(claim)).not.toMatch(claim);
		}
		expect(CERTIFICATE_WORDING).toContain("simple electronic signature");
	});
});

describe("T034 every public route has a budget assertion", () => {
	it("each declared public route answers a bad request within the bridge-call budget", async () => {
		const runtime = await createPluginRuntimeTestHost();
		try {
			const budget = withBudget(runtime);
			for (const spec of PUBLIC_ROUTES) {
				const result = await budget.invokeRoute(spec.name, spec.body === "json" ? {} : undefined);
				expectWithinBudget(result, { calls: 8, cpuMs: 50 });
			}
		} finally {
			await runtime.dispose();
		}
	});
});
