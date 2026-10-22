// Shared steps of the e-sign journey (T033). Everything goes through the real routes: the admin steps
// use the private routes with the e2e API token (esign-admin.mjs), the signer steps the public ones.
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { APIRequestContext } from "@playwright/test";

// @ts-expect-error plain .mjs without types
import { ADMIN_TOKEN } from "./esign-admin.mjs";

const PLUGIN = "/_emdash/api/plugins/semics-esign";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const SIGNER = { name: "Ada Lovelace", email: "ada@example.com" };
export const SIGNER_FIELDS = [{ key: "phone", label: "Phone number", required: true }];
export const PHONE = "+44 20 7946 0000";

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

interface Reply<T> {
	success?: boolean;
	data?: T;
	error?: { code?: string; message?: string };
}

/** Calls a route of the e-sign core and returns its `data` (throws on a transport or route error). */
export async function route<T = Record<string, unknown>>(
	request: APIRequestContext,
	path: string,
	body: unknown,
	admin = false,
): Promise<T> {
	const response = await request.post(`${PLUGIN}/${path}`, {
		data: body,
		headers: { "x-emdash-request": "1", ...(admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}) },
	});
	const reply = (await response.json()) as Reply<T>;
	if (!response.ok() || reply.success === false) {
		throw new Error(`${path}: ${response.status()} ${JSON.stringify(reply.error ?? reply)}`);
	}
	return (reply.data ?? reply) as T;
}

/** The clear-text token of a queued email (`/<page>/<token>`), or null when the row is missing or scrubbed. */
function queuedToken(rowId: string, page: "sign" | "signed"): string | null {
	const db = new DatabaseSync(resolve(root, "data.db"), { readOnly: true });
	try {
		const row = db
			.prepare(`SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-esign' AND collection = 'outbox' AND id = ?`)
			.get(rowId) as { data: string } | undefined;
		return row?.data.match(new RegExp(`/${page}/([A-Za-z0-9_-]{43})`))?.[1] ?? null;
	} finally {
		db.close();
	}
}

/**
 * The signing token. Only its hash is stored on the signer; the token itself travels in the queued
 * invitation (outbox `invite-<signerId>`, clear text until the one-minute drain sends and scrubs it, R32).
 * The test reads it straight after the send. A drain tick could still land in that window, so a scrubbed
 * row makes the caller start a new envelope.
 */
export const readInviteToken = (envelopeId: string) => queuedToken(`invite-${envelopeId}:s1`, "sign");

/**
 * The copy token in the completion email (`complete-<envelopeId>`): it opens `/signed/<token>`; the
 * signing token is not rotated (T115), so the invitation link still works.
 */
export async function waitForCompletionToken(envelopeId: string): Promise<string> {
	const deadline = Date.now() + 30_000;
	for (;;) {
		const token = queuedToken(`complete-${envelopeId}`, "signed");
		if (token) return token;
		if (Date.now() > deadline) throw new Error("the completion email was not queued in time");
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

/** The stored signer document (read-only, straight from the site database). */
export function signerDoc(envelopeId: string): Record<string, unknown> {
	const db = new DatabaseSync(resolve(root, "data.db"), { readOnly: true });
	try {
		const row = db
			.prepare(`SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-esign' AND collection = 'signers' AND id = ?`)
			.get(`${envelopeId}:s1`) as { data: string };
		return JSON.parse(row.data) as Record<string, unknown>;
	} finally {
		db.close();
	}
}

export interface Sent {
	envelopeId: string;
	token: string;
}

/** Admin: create a template, create an envelope with a signer-fillable field, send it, read the token. */
export async function createAndSend(request: APIRequestContext, name = "Venue hire agreement"): Promise<Sent> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const { template } = await route<{ template: { id: string } }>(
			request,
			"templates/create",
			{
				name,
				body: "# Venue hire\n\nI, {{signer.name}}, agree to hire {{venue}} for the event.\n\nSigned for {{company}}.\n",
			},
			true,
		);
		const { envelope } = await route<{ envelope: { id: string } }>(
			request,
			"envelopes/create",
			{
				templateId: template.id,
				title: name,
				signer: SIGNER,
				fields: { venue: "The Old Library", company: "Analytical Engines Ltd" },
				signerFields: SIGNER_FIELDS,
			},
			true,
		);
		await route(request, "envelopes/send", { id: envelope.id }, true);
		const token = readInviteToken(envelope.id);
		if (token) return { envelopeId: envelope.id, token };
	}
	throw new Error("the invitation was scrubbed by the outbox drain three times in a row");
}

export interface Receipt {
	status: string;
	pdfSha256: string | null;
	finalHash: string | null;
	download: { url: string } | null;
}

/** Admin: the envelope as the admin page shows it (the receipt: `pdfSha256`, `finalHash`). */
export async function receipt(request: APIRequestContext, envelopeId: string): Promise<Receipt> {
	const { envelope, download } = await route<{ envelope: Receipt; download: { url: string } | null }>(
		request,
		"envelopes/get",
		{ id: envelopeId },
		true,
	);
	return { ...envelope, download };
}

/**
 * The one-shot job `signed-pdf-<envelopeId>` is due the moment the signer submits; the node scheduler
 * re-arms on `schedule()` and runs it within a second or two, so this polls the admin receipt (no
 * sleeping for the minute-long recurring tick) until the PDF is stored.
 */
export async function waitForPdf(request: APIRequestContext, envelopeId: string): Promise<Receipt> {
	const deadline = Date.now() + 45_000;
	for (;;) {
		const r = await receipt(request, envelopeId);
		if (r.pdfSha256 && r.download) return r;
		if (Date.now() > deadline) throw new Error(`signed PDF not stored in time (status ${r.status})`);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

/** Signs through the public routes only (no browser): session, then submit with a typed signature. */
export async function signViaRoutes(request: APIRequestContext, sent: Sent): Promise<void> {
	const session = await route<{ envelope: { docSha256: string } }>(request, "public/session", { token: sent.token });
	await route(request, "public/submit", {
		token: sent.token,
		docSha256: session.envelope.docSha256,
		consent: true,
		intent: true,
		signature: { kind: "typed", typedName: SIGNER.name },
		fieldValues: { phone: PHONE },
	});
}
