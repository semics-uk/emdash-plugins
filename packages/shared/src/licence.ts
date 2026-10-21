/**
 * Offline Pro licence keys (BUILD-PLAN §13 "How Pro is delivered", R17, D6).
 *
 * A key is `semics1.<payload>.<signature>`: base64url JSON payload and a base64url Ed25519 signature
 * over the ASCII bytes `semics1.<payload>`. Verification is Web Crypto only: no network call, so no
 * licence-server host in the trust contract.
 *
 * - The Pro build injects the public key, its own product and its release date through
 *   `createLicenceVerifier`; nothing here reads them from settings, so a site cannot swap in its
 *   own key pair.
 * - The site's hostname must be in `sites[]` (exact match after normalisation). Local and preview
 *   hosts (`localhost`, `*.localhost`, loopback, `*.workers.dev`, `*.pages.dev`) are exempt and
 *   need no key.
 * - A build released after `updatesUntil` gets `LICENCE_EXPIRED` (renewal needed); builds released
 *   on or before it keep working forever (perpetual fallback). The current time is never consulted.
 * - A `suite` key covers both products.
 *
 * Honest limit: this runs on the customer's site, so it deters copying rather than prevents it.
 */
import { decodeBase64Url, encodeBase64Url } from "./hmac";
import { err, ok, type Result } from "./result";

export const LICENCE_PREFIX = "semics1";
/** Longest key accepted, before any decoding. */
export const LICENCE_MAX_LENGTH = 4096;
/** Most hostnames one key may list (the agency plan covers 10). */
export const LICENCE_MAX_SITES = 100;
export const LICENCE_MAX_CUSTOMER_LENGTH = 200;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

export type LicenceProduct = "events" | "esign" | "suite";
/** The product a Pro build is: a key's product must match it, or be `suite`. */
export type LicenceBuildProduct = "events" | "esign";
export type LicenceError = "LICENCE_INVALID" | "LICENCE_EXPIRED";

export interface LicencePayload {
	v: 1;
	product: LicenceProduct;
	edition: "pro";
	/** Normalised hostnames (see `normaliseHostname`). */
	sites: string[];
	customer: string;
	/** `YYYY-MM-DD`, UTC. */
	issuedAt: string;
	/** `YYYY-MM-DD`, UTC: the last release date this key receives updates for. */
	updatesUntil: string;
}

/** Fixed per Pro build: injected at build time, never read from site settings. */
export interface LicenceBuild {
	/** Raw 32-byte Ed25519 public key, base64url. */
	publicKey: string;
	product: LicenceBuildProduct;
	/** This build's release date, `YYYY-MM-DD`, UTC. */
	buildDate: string;
}

export type LicenceStatus =
	| { kind: "licensed"; hostname: string; licence: LicencePayload }
	| { kind: "exempt"; hostname: string };

export type LicenceResult = Result<LicenceStatus, LicenceError>;

export interface LicenceCheckInput {
	/** The stored `secret` setting; missing when no key was entered. */
	key: string | null | undefined;
	/** The site's host, e.g. from the request URL. A port is ignored. */
	hostname: string;
}

export type LicenceVerifier = (input: LicenceCheckInput) => Promise<LicenceResult>;

const PRODUCTS: readonly string[] = ["events", "esign", "suite"];
const BUILD_PRODUCTS: readonly string[] = ["events", "esign"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOST_CHARS = /^[A-Za-z0-9.:[\]-]+$/;
const EXEMPT_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];
const EXEMPT_SUFFIXES: readonly string[] = [".localhost", ".workers.dev", ".pages.dev"];
const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Lower-case host without port or trailing dot, or `undefined` if `host` is not a bare host. */
export function normaliseHostname(host: string): string | undefined {
	if (!HOST_CHARS.test(host)) return undefined;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname;
	} catch {
		return undefined;
	}
	return hostname.replace(/\.$/, "") || undefined;
}

/** Local and preview hosts, which never need a key (D6). Expects a normalised hostname. */
export function isExemptHost(hostname: string): boolean {
	return EXEMPT_HOSTS.includes(hostname) || EXEMPT_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isDate(value: unknown): value is string {
	if (typeof value !== "string" || !DATE.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isSite(value: unknown): boolean {
	return typeof value === "string" && normaliseHostname(value) === value;
}

/** The payload if `value` is a well-formed licence payload, else `undefined`. Unknown fields are kept. */
export function validateLicencePayload(value: unknown): LicencePayload | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const { v, product, edition, sites, customer, issuedAt, updatesUntil } = value as Record<string, unknown>;
	const valid =
		v === 1 &&
		PRODUCTS.includes(product as string) &&
		edition === "pro" &&
		Array.isArray(sites) &&
		sites.length >= 1 &&
		sites.length <= LICENCE_MAX_SITES &&
		sites.every(isSite) &&
		typeof customer === "string" &&
		customer.length >= 1 &&
		customer.length <= LICENCE_MAX_CUSTOMER_LENGTH &&
		isDate(issuedAt) &&
		isDate(updatesUntil) &&
		issuedAt <= updatesUntil;
	return valid ? (value as LicencePayload) : undefined;
}

/**
 * Issues a key. For the issuing tool and tests only: the private key never ships in a build.
 * Throws if the payload is not valid.
 */
export async function signLicence(payload: LicencePayload, privateKey: CryptoKey): Promise<string> {
	if (!validateLicencePayload(payload)) throw new Error("Licence payload is not valid.");
	const body = encodeBase64Url(utf8.encode(JSON.stringify(payload)));
	const signature = await crypto.subtle.sign("Ed25519", privateKey, utf8.encode(`${LICENCE_PREFIX}.${body}`));
	return `${LICENCE_PREFIX}.${body}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function parsePayload(body: string): LicencePayload | undefined {
	const bytes = decodeBase64Url(body);
	if (!bytes) return undefined;
	try {
		return validateLicencePayload(JSON.parse(strictUtf8.decode(bytes)));
	} catch {
		return undefined;
	}
}

/** The signed payload, or `undefined` for anything not signed by `publicKey` or malformed. */
async function openLicence(key: LicenceCheckInput["key"], publicKey: CryptoKey): Promise<LicencePayload | undefined> {
	const text = key?.trim() ?? "";
	if (text.length > LICENCE_MAX_LENGTH) return undefined;
	const parts = text.split(".");
	if (parts.length !== 3 || parts[0] !== LICENCE_PREFIX) return undefined;
	const [, body, sig] = parts as [string, string, string];
	const signature = decodeBase64Url(sig);
	if (signature?.length !== ED25519_SIGNATURE_BYTES) return undefined;
	const signed = utf8.encode(`${LICENCE_PREFIX}.${body}`);
	if (!(await crypto.subtle.verify("Ed25519", publicKey, new Uint8Array(signature), signed))) return undefined;
	return parsePayload(body);
}

/**
 * Binds the build-time public key, product and release date, and returns the per-request check.
 * Throws on a bad build configuration (a packaging error, not a site error).
 */
export function createLicenceVerifier(build: LicenceBuild): LicenceVerifier {
	const raw = decodeBase64Url(build.publicKey);
	if (raw?.length !== ED25519_PUBLIC_KEY_BYTES) {
		throw new Error("Licence public key must be 32 raw Ed25519 bytes, base64url.");
	}
	if (!isDate(build.buildDate)) throw new Error("Licence build date must be YYYY-MM-DD.");
	if (!BUILD_PRODUCTS.includes(build.product)) throw new Error("Licence build product must be events or esign.");
	const { product, buildDate } = build;
	let imported: Promise<CryptoKey> | undefined;
	const publicKey = () => {
		imported ??= crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "Ed25519" }, false, ["verify"]);
		return imported;
	};

	return async ({ key, hostname }) => {
		const host = normaliseHostname(hostname);
		if (host === undefined) return err("LICENCE_INVALID");
		if (isExemptHost(host)) return ok({ kind: "exempt", hostname: host });
		const licence = await openLicence(key, await publicKey());
		const covers = licence !== undefined && (licence.product === product || licence.product === "suite");
		if (!covers || !licence.sites.includes(host)) return err("LICENCE_INVALID");
		if (buildDate > licence.updatesUntil) return err("LICENCE_EXPIRED");
		return ok({ kind: "licensed", hostname: host, licence });
	};
}
