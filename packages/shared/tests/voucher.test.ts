import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	decodeBase64Url,
	encodeBase64Url,
	formatVoucherPairing,
	type HoldPayload,
	parseVoucherPairing,
	type SettlePayload,
	signVoucherToken,
	VOUCHER_MAX_TOKEN_LENGTH,
	VOUCHER_PREFIXES,
	type VoucherClient,
	type VoucherLookupPayload,
	type VoucherTokenType,
	validateVoucherPayload,
	verifyVoucherToken,
} from "../src/index";

// --- voucher-vectors.json (docs/protocol, generated; never edited by hand) ---

interface VectorClient {
	secret: string;
	revoked: boolean;
}
interface TokenVector {
	name: string;
	type: VoucherTokenType;
	input: {
		token: string;
		expectedPrefix: string;
		signedWithPrefix?: string;
		signedWithSecret?: string;
		payload?: unknown;
		tamper?: string;
	};
	verifier: { now: number; clients: Record<string, VectorClient> };
	expected: { ok: true; payload: unknown } | { ok: false; error: string };
}
interface PairingVector {
	name: string;
	type: "pairing";
	input: { pairing: string };
	expected: { ok: true; clientId: string; secret: string } | { ok: false; error: string };
}
interface VectorFile {
	constants: { prefixes: Record<VoucherTokenType, string>; maxTokenLength: Record<VoucherTokenType, number> };
	keys: Record<"A" | "B" | "R", { cid: string; secret: string; pairing: string }>;
	vectors: Array<TokenVector | PairingVector | { name: string; type: "code" }>;
}

const file: VectorFile = JSON.parse(
	readFileSync(new URL("../../../docs/protocol/voucher-vectors.json", import.meta.url), "utf8"),
);
const TYPES: readonly VoucherTokenType[] = ["hold", "settle", "lookup"];
const tokenVectors = file.vectors.filter((v): v is TokenVector => TYPES.includes(v.type as VoucherTokenType));
const pairingVectors = file.vectors.filter((v): v is PairingVector => v.type === "pairing");
const KEY_A = file.keys.A;
const bytes = (b64: string) => decodeBase64Url(b64) as Uint8Array;
const NOW_S = 1_800_000_000;
const NOW = NOW_S * 1000;

function clientTable(clients: Record<string, VectorClient>) {
	return (cid: string): VoucherClient | undefined => {
		if (!Object.hasOwn(clients, cid)) return undefined;
		const c = clients[cid] as VectorClient;
		return { secret: bytes(c.secret), revoked: c.revoked };
	};
}

const outcome = (r: { ok: true; value: unknown } | { ok: false; error: unknown }) =>
	r.ok ? { ok: true, payload: r.value } : { ok: false, error: r.error };

describe("T164 voucher/1 vectors", () => {
	it("has the constants the spec defines and vectors of every type", () => {
		expect(VOUCHER_PREFIXES).toEqual(file.constants.prefixes);
		expect(VOUCHER_MAX_TOKEN_LENGTH).toEqual(file.constants.maxTokenLength);
		expect(new Set(tokenVectors.map((v) => v.type))).toEqual(new Set(TYPES));
		expect(tokenVectors.length).toBeGreaterThanOrEqual(100);
	});

	it.each(tokenVectors.map((v) => [v.name, v] as const))("%s produces its expected outcome", async (_n, v) => {
		const result = await verifyVoucherToken(v.type, {
			token: v.input.token,
			now: v.verifier.now * 1000,
			getClient: clientTable(v.verifier.clients),
		});
		expect(outcome(result)).toEqual(v.expected);
	});

	const reproducible = tokenVectors.filter(
		(v) =>
			v.input.tamper === undefined &&
			v.input.signedWithPrefix === v.input.expectedPrefix &&
			v.input.signedWithSecret !== undefined &&
			v.input.token.length <= VOUCHER_MAX_TOKEN_LENGTH[v.type] &&
			validateVoucherPayload(v.type, v.input.payload).ok,
	);

	it("has signable vectors of every type", () => {
		expect(new Set(reproducible.map((v) => v.type))).toEqual(new Set(TYPES));
	});

	it.each(reproducible.map((v) => [v.name, v] as const))(
		"%s is reproduced byte for byte by the issuer",
		async (_n, v) => {
			const token = await signVoucherToken(
				v.type,
				v.input.payload as HoldPayload,
				bytes(v.input.signedWithSecret as string),
			);
			expect(token).toBe(v.input.token);
		},
	);

	it.each(pairingVectors.map((v) => [v.name, v] as const))("pairing %s", (_n, v) => {
		const result = parseVoucherPairing(v.input.pairing);
		if (v.expected.ok) {
			expect(result.ok && result.value.clientId).toBe(v.expected.clientId);
			expect(result.ok && encodeBase64Url(result.value.secret)).toBe(v.expected.secret);
		} else {
			expect(result).toEqual({ ok: false, error: v.expected.error });
		}
	});
});

// --- targeted tests ---

const hold = (over: Record<string, unknown> = {}): HoldPayload =>
	({
		v: 1,
		typ: "hold",
		cid: KEY_A.cid,
		rid: "rd_1",
		iat: NOW_S - 60,
		exp: NOW_S + 600,
		ref: "BK7Q2M",
		kind: "money",
		amountMinor: 2500,
		currency: "GBP",
		...over,
	}) as HoldPayload;

const activity = (over: Record<string, unknown> = {}) =>
	hold({ kind: "activity", amountMinor: 0, line: { eventId: "ev_1", ticketTypeId: "tt_1" }, ...over });

const settle = (over: Record<string, unknown> = {}): SettlePayload =>
	({
		v: 1,
		typ: "settle",
		cid: KEY_A.cid,
		rid: "rd_1",
		ref: "BK7Q2M",
		outcome: "confirmed",
		creditMinor: 0,
		at: NOW_S,
		...over,
	}) as SettlePayload;

const lookup = (over: Record<string, unknown> = {}): VoucherLookupPayload =>
	({ v: 1, typ: "lookup", cid: KEY_A.cid, ts: NOW_S, ref: "BK7Q2M", rid: "rd_1", ...over }) as VoucherLookupPayload;

const valid = (type: VoucherTokenType, p: unknown) => validateVoucherPayload(type, p).ok;
const errorOf = (type: VoucherTokenType, p: unknown) => {
	const r = validateVoucherPayload(type, p);
	return r.ok ? "ok" : r.error;
};
const secretA = () => bytes(KEY_A.secret);
const getClient = (cid: string): VoucherClient | undefined =>
	cid === KEY_A.cid ? { secret: secretA(), revoked: false } : undefined;

describe("T164 hold schema bounds", () => {
	it("accepts both kinds at their limits", () => {
		expect(valid("hold", hold())).toBe(true);
		expect(valid("hold", hold({ amountMinor: 1 }))).toBe(true);
		expect(valid("hold", hold({ amountMinor: 10_000_000 }))).toBe(true);
		expect(valid("hold", activity())).toBe(true);
		expect(valid("hold", activity({ amountMinor: 10_000_000 }))).toBe(true);
		expect(valid("hold", hold({ rid: "r".repeat(64), ref: "R".repeat(128) }))).toBe(true);
	});

	it.each([
		["amountMinor 0 for money", { amountMinor: 0 }],
		["amountMinor over the max", { amountMinor: 10_000_001 }],
		["fractional amountMinor", { amountMinor: 1.5 }],
		["string amountMinor", { amountMinor: "1" }],
		["unsafe amountMinor", { amountMinor: 2 ** 53 }],
		["lowercase currency", { currency: "gbp" }],
		["two-letter currency", { currency: "GB" }],
		["unknown kind", { kind: "gift" }],
		["rid of 65 characters", { rid: "r".repeat(65) }],
		["empty rid", { rid: "" }],
		["ref of 129 characters", { ref: "R".repeat(129) }],
		["ref with a slash", { ref: "BK/1" }],
		["missing iat", { iat: undefined }],
		["negative exp", { exp: -1 }],
		["exp equal to iat", { exp: NOW_S - 60 }],
		["money with a line", { line: { eventId: "ev_1", ticketTypeId: "tt_1" } }],
		["wrong v", { v: 2 }],
		["wrong typ", { typ: "settle" }],
		["bad cid", { cid: "x" }],
	])("rejects %s", (_label, over) => {
		expect(errorOf("hold", hold(over))).toBe("PAYLOAD_INVALID");
	});

	it.each([
		["no line", { line: undefined }],
		["a null line", { line: null }],
		["a line without eventId", { line: { ticketTypeId: "tt_1" } }],
		["a line with a bad ticketTypeId", { line: { eventId: "ev_1", ticketTypeId: "tt 1" } }],
		["a negative amount", { amountMinor: -1 }],
	])("rejects an activity hold with %s", (_label, over) => {
		expect(errorOf("hold", activity(over))).toBe("PAYLOAD_INVALID");
	});

	it("reports an over-long lifetime only after the other schema checks", () => {
		expect(errorOf("hold", hold({ exp: NOW_S - 60 + 1800 }))).toBe("ok");
		expect(errorOf("hold", hold({ exp: NOW_S - 60 + 1801 }))).toBe("TOKEN_LIFETIME_EXCEEDED");
		expect(errorOf("hold", hold({ exp: NOW_S + 9999, currency: "x" }))).toBe("PAYLOAD_INVALID");
	});

	it("rejects payloads that are not objects", () => {
		for (const p of [null, [], "hold", 1]) expect(errorOf("hold", p)).toBe("PAYLOAD_INVALID");
	});
});

describe("T164 settle and lookup schema bounds", () => {
	it("ties creditMinor to the outcome", () => {
		expect(valid("settle", settle())).toBe(true);
		expect(valid("settle", settle({ outcome: "released" }))).toBe(true);
		expect(valid("settle", settle({ outcome: "credited", creditMinor: 1 }))).toBe(true);
		expect(valid("settle", settle({ outcome: "credited", creditMinor: 10_000_000 }))).toBe(true);
		expect(valid("settle", settle({ outcome: "credited", creditMinor: 0 }))).toBe(false);
		expect(valid("settle", settle({ outcome: "credited", creditMinor: 10_000_001 }))).toBe(false);
		expect(valid("settle", settle({ creditMinor: 1 }))).toBe(false);
		expect(valid("settle", settle({ outcome: "released", creditMinor: 1 }))).toBe(false);
		expect(valid("settle", settle({ creditMinor: undefined }))).toBe(false);
		expect(valid("settle", settle({ outcome: "refunded" }))).toBe(false);
		expect(valid("settle", settle({ at: -1 }))).toBe(false);
		expect(valid("settle", settle({ rid: "r 1" }))).toBe(false);
		expect(valid("settle", settle({ ref: "" }))).toBe(false);
	});

	it("needs ts, ref and rid on a lookup", () => {
		expect(valid("lookup", lookup())).toBe(true);
		expect(valid("lookup", lookup({ ts: 1.5 }))).toBe(false);
		expect(valid("lookup", lookup({ ref: undefined }))).toBe(false);
		expect(valid("lookup", lookup({ rid: undefined }))).toBe(false);
	});
});

describe("T164 verification", () => {
	it("round-trips every type and checks time with inclusive boundaries", async () => {
		const run = (type: VoucherTokenType, token: unknown, now = NOW) =>
			verifyVoucherToken(type, { token, now, getClient });
		const h = await signVoucherToken("hold", hold(), secretA());
		expect((await run("hold", h)).ok).toBe(true);
		expect((await run("hold", h, (NOW_S + 660) * 1000 + 999)).ok).toBe(true);
		expect(await run("hold", h, (NOW_S + 661) * 1000)).toEqual({ ok: false, error: "TOKEN_EXPIRED" });
		const l = await signVoucherToken("lookup", lookup(), secretA());
		expect((await run("lookup", l, (NOW_S + 360) * 1000)).ok).toBe(true);
		expect(await run("lookup", l, (NOW_S + 361) * 1000)).toEqual({ ok: false, error: "TOKEN_EXPIRED" });
		const s = await signVoucherToken("settle", settle({ at: NOW_S + 61 }), secretA());
		expect(await run("settle", s)).toEqual({ ok: false, error: "TOKEN_NOT_YET_VALID" });
		const old = await signVoucherToken("settle", settle({ at: 0 }), secretA());
		expect((await run("settle", old)).ok).toBe(true);
	});

	it("rejects non-strings, oversize tokens and revoked clients, and accepts async lookups", async () => {
		expect(await verifyVoucherToken("hold", { token: 1, now: NOW, getClient })).toEqual({
			ok: false,
			error: "TOKEN_MALFORMED",
		});
		expect(await verifyVoucherToken("hold", { token: "x".repeat(1025), now: NOW, getClient })).toEqual({
			ok: false,
			error: "TOKEN_TOO_LARGE",
		});
		const token = await signVoucherToken("hold", hold(), secretA());
		const revoked = async () => ({ secret: secretA(), revoked: true });
		expect(await verifyVoucherToken("hold", { token, now: NOW, getClient: revoked })).toEqual({
			ok: false,
			error: "CLIENT_REVOKED",
		});
		const asyncClient = async (cid: string) => getClient(cid);
		expect((await verifyVoucherToken("hold", { token, now: NOW, getClient: asyncClient })).ok).toBe(true);
	});

	it("a token of each type fails every other type's verifier", async () => {
		const tokens = {
			hold: await signVoucherToken("hold", hold(), secretA()),
			settle: await signVoucherToken("settle", settle(), secretA()),
			lookup: await signVoucherToken("lookup", lookup(), secretA()),
		};
		for (const expected of TYPES) {
			for (const presented of TYPES) {
				if (expected === presented) continue;
				const r = await verifyVoucherToken(expected, { token: tokens[presented], now: NOW, getClient });
				expect(r).toEqual({ ok: false, error: "TOKEN_INVALID" });
			}
		}
	});

	it("the issuer refuses invalid payloads, wrong-size secrets and oversize tokens", async () => {
		await expect(signVoucherToken("hold", hold({ amountMinor: 0 }), secretA())).rejects.toThrow("PAYLOAD_INVALID");
		await expect(signVoucherToken("hold", hold(), new Uint8Array(31))).rejects.toThrow("32 bytes");
		await expect(signVoucherToken("hold", hold({ pad: "x".repeat(1000) }), secretA())).rejects.toThrow(
			"TOKEN_TOO_LARGE",
		);
	});
});

describe("T164 voucher pairing", () => {
	it("formats and parses a voucher1 pairing", () => {
		const secret = secretA();
		const pairing = formatVoucherPairing(KEY_A.cid, secret);
		expect(pairing).toBe(KEY_A.pairing);
		const parsed = parseVoucherPairing(pairing);
		expect(parsed.ok && parsed.value.clientId).toBe(KEY_A.cid);
	});

	it("refuses bad inputs", () => {
		expect(() => formatVoucherPairing("x", secretA())).toThrow();
		expect(() => formatVoucherPairing(KEY_A.cid, new Uint8Array(31))).toThrow();
		expect(parseVoucherPairing(42 as unknown as string)).toEqual({ ok: false, error: "PAIRING_MALFORMED" });
	});
});
