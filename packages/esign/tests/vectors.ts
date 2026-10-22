import { createHmac } from "node:crypto";
import { deriveClientSecret } from "@semics-tech/shared";
import VECTORS from "../../../docs/protocol/vectors.json";

// Protocol vectors replayed through the real routes (T061 pattern, T062). The routes derive each
// client's secret from the master key (S8) and read the real clock, so a vector is re-minted: its
// payload text is kept, its time fields are shifted by (now - verifier.now) with the same digit
// count, and it is re-signed with the derived secret of the test key it used, applying the same
// tamper. Tokens that fail before a key is chosen (malformed, oversize) are sent unchanged.

export interface Vector {
	name: string;
	type: string;
	input: {
		token: string;
		signedWithPrefix?: string;
		signedWithSecret?: string;
		payload?: Record<string, unknown>;
		tamper?: string;
	};
	verifier: {
		now: number;
		clients: Record<string, { secret: string; revoked: boolean; returnUrlAllowlist?: string[] }>;
		usedNonces: Array<{ cid: string; nonce: string }>;
	};
	expected: { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };
}

export const FILE = VECTORS as unknown as { keys: Record<string, { cid: string; secret: string }>; vectors: Vector[] };
export const vectorsOf = (type: string) => FILE.vectors.filter((v) => v.type === type);
export const MASTER = "master-key-for-tests-0123456789abcdef";
export const nowS = () => Math.floor(Date.now() / 1000);

export async function derived(cid: string): Promise<Buffer> {
	return Buffer.from(await deriveClientSecret(new TextEncoder().encode(MASTER), cid));
}

function keyCid(secret: string): string {
	const key = Object.values(FILE.keys).find((k) => k.secret === secret);
	if (!key) throw new Error(`vector secret ${secret} is not one of the test keys`);
	return key.cid;
}

const TIME_FIELDS = /"(iat|exp|ts|at)":(\d+)/g;
const shiftTimes = (text: string, shift: number) =>
	text.replace(TIME_FIELDS, (_m, field: string, n: string) => `"${field}":${Number(n) + shift}`);
const segmentText = (token: string) => Buffer.from(token.split(".")[0] as string, "base64url").toString("utf8");
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

async function sig(secret: string, prefix: string, payloadB64: string): Promise<Buffer> {
	return createHmac("sha256", await derived(keyCid(secret)))
		.update(`${prefix}.${payloadB64}`)
		.digest();
}

/** The vector's token as a site whose clock reads `verifier.now + shift` and whose secrets are derived. */
export async function routeToken(v: Vector, shift: number): Promise<string> {
	const error = v.expected.ok ? undefined : v.expected.error;
	if (error === "TOKEN_MALFORMED" || error === "TOKEN_TOO_LARGE") return v.input.token;
	const { signedWithPrefix: prefix, signedWithSecret: secret, tamper } = v.input;
	if (!prefix || !secret) throw new Error(`${v.name}: no signing key`);
	const payloadB64 = b64(shiftTimes(segmentText(v.input.token), shift));
	let signature: Buffer;
	if (tamper === "payload segment replaced") {
		// Signed over the type's valid payload; the edited payload is sent.
		const original = FILE.vectors.find((x) => x.name === `${v.type}/valid`) as Vector;
		signature = await sig(secret, prefix, b64(shiftTimes(segmentText(original.input.token), shift)));
	} else {
		signature = await sig(secret, prefix, payloadB64);
		if (tamper === "signature bit flipped") signature[0] = (signature[0] as number) ^ 1;
		else if (tamper !== undefined) throw new Error(`${v.name}: unknown tamper ${tamper}`);
	}
	const token = `${payloadB64}.${signature.toString("base64url")}`;
	if (token.length !== v.input.token.length) throw new Error(`${v.name}: re-minted token changed length`);
	return token;
}

/** Waits for the start of a second, so a call can finish inside the second its token was built in. */
export async function secondStart(): Promise<void> {
	const ms = Date.now() % 1000;
	if (ms > 150) await new Promise((resolve) => setTimeout(resolve, 1005 - ms));
}
