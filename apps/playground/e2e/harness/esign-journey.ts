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

interface Mail {
	to: string;
	subject: string;
	text: string;
}

/**
 * The email the site delivered to `to` whose subject matches (T056 mail capture, `/e2e/mail`). Between
 * looks it runs the e-sign outbox drain once (`/e2e/cron`), which sends what is due: the drain renders
 * and sends the message, then scrubs the outbox row (R32), so the captured email is the one place the
 * link's token can be read, exactly as the signer receives it.
 */
async function mailTo(request: APIRequestContext, to: string, subject: RegExp): Promise<Mail> {
	for (let tick = 0; tick < 30; tick++) {
		const { messages } = (await (await request.get(`/e2e/mail?to=${encodeURIComponent(to)}`)).json()) as {
			messages: Mail[];
		};
		const found = messages.find((m) => subject.test(m.subject));
		if (found) return found;
		const ran = await request.post("/e2e/cron?task=outbox-drain&plugin=semics-esign");
		if (!ran.ok()) throw new Error(`e2e cron: ${ran.status()}`);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`no email "${subject}" to ${to}`);
}

/** The token in an emailed `/<page>/<token>` link. */
function linkToken(mail: Mail, page: "sign" | "signed"): string {
	const token = mail.text.match(new RegExp(`/${page}/([A-Za-z0-9_-]{43})`))?.[1];
	if (!token) throw new Error(`no /${page}/ link in "${mail.subject}"`);
	return token;
}

/** The signing token, from the invitation email's `/sign/<token>` link (only its hash is stored). */
export async function readInviteToken(request: APIRequestContext, email: string): Promise<string> {
	return linkToken(await mailTo(request, email, /asks you to sign/), "sign");
}

/**
 * The copy token in the completion email: it opens `/signed/<token>`; the signing token is not rotated
 * (T115), so the invitation link still works.
 */
export async function waitForCompletionToken(request: APIRequestContext, sent: Sent): Promise<string> {
	return linkToken(await mailTo(request, sent.email, /^Signed: /), "signed");
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
	/** The signer's address, unique per envelope so its emails are told apart in the mailbox. */
	email: string;
}

let signerSeq = 0;

/** Admin: create a template, create an envelope with a signer-fillable field, send it, read the emailed link. */
export async function createAndSend(request: APIRequestContext, name = "Venue hire agreement"): Promise<Sent> {
	signerSeq += 1;
	const email = `ada.${Date.now()}.${signerSeq}@example.com`;
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
			signer: { ...SIGNER, email },
			fields: { venue: "The Old Library", company: "Analytical Engines Ltd" },
			signerFields: SIGNER_FIELDS,
		},
		true,
	);
	await route(request, "envelopes/send", { id: envelope.id }, true);
	return { envelopeId: envelope.id, token: await readInviteToken(request, email), email };
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
