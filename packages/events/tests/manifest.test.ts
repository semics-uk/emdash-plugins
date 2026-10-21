import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SECRET_SETTING_KEYS, STORAGE_COLLECTIONS } from "../src/storage/schema";

const root = resolve(import.meta.dirname, "..");

/** Read the shipped manifest from disk (JSONC: whole-line comments only). */
function readManifest(): Record<string, any> {
	const text = readFileSync(resolve(root, "emdash-plugin.jsonc"), "utf8");
	return JSON.parse(
		text
			.split("\n")
			.filter((line) => !line.trim().startsWith("//"))
			.join("\n")
			.replace(/,(\s*[}\]])/g, "$1"),
	);
}

// The storage table of BUILD-PLAN 3.1, written out independently of src/storage/schema.ts.
const EXPECTED_STORAGE = {
	event_configs: { indexes: ["status", "salesEnd"], uniqueIndexes: [] },
	occurrences: { indexes: [["eventId", "startsAt"], "startsAt", "status"], uniqueIndexes: [] },
	ticket_types: { indexes: ["eventId"], uniqueIndexes: [] },
	bookings: {
		indexes: ["eventId", "status", "email", "createdAt", ["status", "holdExpiresAt"], ["eventId", "status"]],
		uniqueIndexes: ["ref"],
	},
	payments: { indexes: ["bookingId"], uniqueIndexes: [] },
	attendees: {
		indexes: ["bookingId", "eventId", "email", ["eventId", "checkedInAt"]],
		uniqueIndexes: ["code"],
	},
	waitlist: { indexes: [["eventId", "status"], "offerExpiresAt"], uniqueIndexes: [] },
	promo_codes: { indexes: ["eventId"], uniqueIndexes: ["code"] },
	outbox: { indexes: [["status", "nextAttemptAt"]], uniqueIndexes: [] },
};

describe("manifest (EU-FR-01, BUILD-PLAN 3.1)", () => {
	it("validates with emdash-plugin validate", () => {
		const bin = resolve(root, "node_modules/.bin/emdash-plugin");
		expect(() => execFileSync(bin, ["validate"], { cwd: root, stdio: "pipe" })).not.toThrow();
	});

	it("declares exactly the Free trust contract capabilities", () => {
		expect([...readManifest().capabilities].sort()).toEqual(
			["content:read", "email:send", "network:request", "schema:read"].sort(),
		);
	});

	it("allows exactly one outbound host: challenges.cloudflare.com (Free edition)", () => {
		expect(readManifest().allowedHosts).toEqual(["challenges.cloudflare.com"]);
	});

	it("declares every storage collection with its indexes and unique indexes", () => {
		const storage = readManifest().storage as Record<string, { indexes?: unknown[]; uniqueIndexes?: unknown[] }>;
		expect(Object.keys(storage).sort()).toEqual(Object.keys(EXPECTED_STORAGE).sort());
		for (const [name, expected] of Object.entries(EXPECTED_STORAGE)) {
			expect(storage[name]?.indexes ?? [], name).toEqual(expected.indexes);
			expect(storage[name]?.uniqueIndexes ?? [], name).toEqual(expected.uniqueIndexes);
		}
	});

	it("keeps src/storage/schema.ts in step with the manifest", () => {
		const storage = readManifest().storage as Record<string, { indexes?: unknown[]; uniqueIndexes?: unknown[] }>;
		for (const [name, declared] of Object.entries(STORAGE_COLLECTIONS)) {
			expect(declared.indexes, name).toEqual(storage[name]?.indexes ?? []);
			expect(declared.uniqueIndexes, name).toEqual(storage[name]?.uniqueIndexes ?? []);
		}
		expect(Object.keys(STORAGE_COLLECTIONS).sort()).toEqual(Object.keys(storage).sort());
	});

	it("has no unique index on payments: the document id gives webhook idempotency", () => {
		expect(readManifest().storage.payments.uniqueIndexes ?? []).toEqual([]);
	});
});

describe("settings schema", () => {
	const settings = () => readManifest().admin.settingsSchema as Record<string, Record<string, unknown>>;

	it("maps the events collection and its fields", () => {
		const s = settings();
		expect(s.eventsCollection).toMatchObject({ type: "string", default: "events" });
		for (const key of ["fieldStartsAt", "fieldEndsAt", "fieldTimezone", "fieldVenue"]) {
			expect(s[key]?.type, key).toBe("string");
		}
		expect(s.fieldStartsAt?.default).toBe("starts_at");
		expect(s.fieldEndsAt?.default).toBe("ends_at");
		expect(s.fieldTimezone?.default).toBe("timezone");
		expect(s.fieldVenue?.default).toBe("venue");
	});

	it("defaults hold TTLs to 15 and 35 minutes with a 60 minute ceiling", () => {
		const s = settings();
		expect(s.holdMinutesFree).toMatchObject({ type: "number", default: 15 });
		expect(s.holdMinutesPaid).toMatchObject({ type: "number", default: 35 });
		expect(s.holdCeilingMinutes).toMatchObject({ type: "number", default: 60 });
	});

	it("has currency, retention days (365) and the email sender name", () => {
		const s = settings();
		expect(s.currency?.default).toBe("GBP");
		expect(s.retentionDays).toMatchObject({ type: "number", default: 365 });
		expect(s.emailSenderName?.type).toBe("string");
	});

	it("keeps credentials as secret fields and the public site key as plain text", () => {
		const s = settings();
		expect(s.turnstileSiteKey?.type).toBe("string");
		expect(s.turnstileSecretKey?.type).toBe("secret");
		expect(s.esignPairing?.type).toBe("secret");
		const secrets = Object.entries(s)
			.filter(([, field]) => field.type === "secret")
			.map(([key]) => key)
			.sort();
		expect(secrets).toEqual(["esignPairing", "turnstileSecretKey"]);
		expect([...SECRET_SETTING_KEYS].sort()).toEqual(secrets);
	});

	it("is a Free edition: no Stripe settings", () => {
		expect(Object.keys(settings()).filter((k) => /stripe/i.test(k))).toEqual([]);
	});
});
