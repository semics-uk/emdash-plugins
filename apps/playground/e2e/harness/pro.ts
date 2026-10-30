// Shared steps of the Pro e2e specs (T135). They run only when the playground is built with Events Pro
// (`EMDASH_PRO_DIR=<Pro checkout>`, staging/link-pro.mjs) and skip on the Free build every other spec
// expects. Events are made the way an operator makes them: an entry through the content API, then the
// Tickets & booking panel's `config/save`, with the e2e admin token (esign-admin.mjs). What only time
// can do (a deadline passing) is done by moving the stored instant into the past in `data.db`, then
// running the real sweeper through `/e2e/cron`.
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, test } from "@playwright/test";

// @ts-expect-error plain .mjs without types
import { ADMIN_TOKEN } from "./esign-admin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const EVENTS = "/_emdash/api/plugins/semics-events";
export const BOOKING_URL = /\/booking\?ref=([0-9A-Z]{10})/;
export const admin = { authorization: `Bearer ${ADMIN_TOKEN}`, "x-emdash-request": "1" };
/** The fake Stripe's port: the one playwright.config.ts gives the server in E2E_STRIPE_URL. */
export const stripePort = () => Number(process.env.E2E_STRIPE_PORT ?? Number(process.env.E2E_PORT ?? 4401) + 1);

let proChecked: boolean | undefined;
/** Whether the site runs Events Pro: its private `pro/licence` route answers `edition: "pro"`. */
export async function isPro(request: APIRequestContext): Promise<boolean> {
	if (proChecked === undefined) {
		const res = await request.get(`${EVENTS}/pro/licence`, { headers: admin });
		const body = res.ok() ? ((await res.json()) as { data?: { edition?: string } }) : {};
		proChecked = body.data?.edition === "pro";
	}
	return proChecked;
}

/** Skips the calling test unless the site runs Events Pro. */
export async function requirePro(request: APIRequestContext) {
	test.skip(!(await isPro(request)), "Events Pro is not linked (build with EMDASH_PRO_DIR=<Pro checkout>)");
}

/** Calls a route of the events core, as the admin when `asAdmin`; returns `data` or throws. */
export async function eventsRoute<T = Record<string, unknown>>(
	request: APIRequestContext,
	path: string,
	body: unknown,
	asAdmin = true,
): Promise<T> {
	const res = await request.post(`${EVENTS}/${path}`, { data: body, headers: asAdmin ? admin : { "x-emdash-request": "1" } });
	const reply = (await res.json()) as { data?: T; error?: unknown };
	if (!res.ok()) throw new Error(`${path}: ${res.status()} ${JSON.stringify(reply)}`);
	return (reply.data ?? reply) as T;
}

/** Saves Events settings (Pro ones included) as the plugin settings page does. */
export async function saveSettings(request: APIRequestContext, values: Record<string, unknown>) {
	const res = await request.put("/_emdash/api/admin/plugins/semics-events/settings", { data: { values }, headers: admin });
	expect(res.ok(), await res.text()).toBe(true);
}

export interface NewEvent {
	slug: string;
	title: string;
	startsAt: string;
	timezone?: string;
	config: Record<string, unknown>;
	ticketTypes: Array<Record<string, unknown>>;
	occurrences?: Array<Record<string, unknown>>;
}

/** Creates and publishes an `events` entry, then saves its booking config; returns the event id. */
export async function createEvent(request: APIRequestContext, e: NewEvent): Promise<string> {
	const created = await request.post("/_emdash/api/content/events", {
		headers: admin,
		data: {
			slug: e.slug,
			data: {
				title: e.title,
				starts_at: e.startsAt,
				timezone: e.timezone ?? "Europe/London",
				venue: "The Hall, London",
				summary: `${e.title} (e2e)`,
			},
		},
	});
	expect(created.ok(), await created.text()).toBe(true);
	const { data } = (await created.json()) as { data: { item: { id: string } } };
	const id = data.item.id;
	const published = await request.post(`/_emdash/api/content/events/${id}/publish`, { headers: admin });
	expect(published.ok(), await published.text()).toBe(true);
	const saved = await request.post(`${EVENTS}/config/save`, {
		headers: admin,
		data: { eventId: id, config: e.config, ticketTypes: e.ticketTypes, occurrences: e.occurrences ?? [] },
	});
	expect(saved.ok(), await saved.text()).toBe(true);
	return id;
}

/** Pairs Events with e-sign (an integration client) and makes a waiver template; returns its id. */
export async function pairEsign(request: APIRequestContext, baseURL: string): Promise<string> {
	const esign = async <T>(path: string, body: unknown): Promise<T> => {
		const res = await request.post(`/_emdash/api/plugins/semics-esign/${path}`, { data: body, headers: admin });
		const reply = (await res.json()) as { data?: T };
		if (!res.ok()) throw new Error(`${path}: ${res.status()} ${JSON.stringify(reply)}`);
		return reply.data as T;
	};
	await esign("admin", { type: "block_action", action_id: "integrations.generate-key" }).catch(() => null);
	const created = await esign("admin", {
		type: "form_submit",
		action_id: "client.create",
		values: { name: "Events", returnUrlAllowlist: `${baseURL}/booking` },
	});
	const pairing = /esign1\.[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}/.exec(JSON.stringify(created));
	expect(pairing, "a pairing string").not.toBeNull();
	await saveSettings(request, { esignPairing: pairing?.[0] });
	const { template } = await esign<{ template: { id: string } }>("templates/create", {
		name: "Activity waiver",
		body: "# Waiver\n\nI, {{signer.name}}, accept the risks of this activity.\n",
		integrations: true,
	});
	return template.id;
}

// --- storage, read and written as the server keeps it -------------------------------------------

function db<T>(fn: (d: DatabaseSync) => T): T {
	const d = new DatabaseSync(resolve(root, "data.db"));
	try {
		return fn(d);
	} finally {
		d.close();
	}
}

export interface StoredBooking {
	id: string;
	data: Record<string, unknown> & { status: string; holdExpiresAt?: string | null };
}

/** The stored booking with this ref. */
export function bookingByRef(ref: string): StoredBooking {
	const row = db((d) =>
		d
			.prepare(
				`SELECT id, data FROM _plugin_storage WHERE plugin_id = 'semics-events' AND collection = 'bookings' AND json_extract(data, '$.ref') = ?`,
			)
			.get(ref),
	) as { id: string; data: string } | undefined;
	if (!row) throw new Error(`no booking ${ref}`);
	return { id: row.id, data: JSON.parse(row.data) };
}

/** Merges `patch` into a stored booking (to move a deadline into the past). */
export function patchBooking(id: string, patch: Record<string, unknown>) {
	db((d) => {
		const where = `WHERE plugin_id = 'semics-events' AND collection = 'bookings' AND id = ?`;
		const row = d.prepare(`SELECT data FROM _plugin_storage ${where}`).get(id) as { data: string };
		d.prepare(`UPDATE _plugin_storage SET data = ? ${where}`).run(JSON.stringify({ ...JSON.parse(row.data), ...patch }), id);
	});
}

/** A booking's stored attendees (`<bookingId>-<seat>`), seat order. */
export function attendeesOf(bookingId: string): Array<Record<string, unknown>> {
	const rows = db((d) =>
		d
			.prepare(
				`SELECT id, data FROM _plugin_storage WHERE plugin_id = 'semics-events' AND collection = 'attendees' AND id LIKE ? ORDER BY id`,
			)
			.all(`${bookingId}-%`),
	) as Array<{ id: string; data: string }>;
	return rows.map((r) => JSON.parse(r.data));
}

/** A stored payment record (`stripe:<session>`). */
export function paymentRecord(sessionId: string): Record<string, unknown> | null {
	const row = db((d) =>
		d
			.prepare(`SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-events' AND collection = 'payments' AND id = ?`)
			.get(`stripe:${sessionId}`),
	) as { data: string } | undefined;
	return row ? JSON.parse(row.data) : null;
}

// --- emails and cron ------------------------------------------------------------------------------

interface Mail {
	to: string;
	subject: string;
	text: string;
}

/**
 * Runs a core's cron task now (`/e2e/cron`). On a fresh server the recurring tasks are only scheduled
 * after a first public read (T116), so this reads `public/events` once and retries until the task ran.
 */
export async function runCron(request: APIRequestContext, task: string, plugin = "semics-events") {
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await request.post(`/e2e/cron?task=${task}&plugin=${plugin}`);
		expect(res.ok()).toBe(true);
		if (((await res.json()) as { scheduled?: number }).scheduled || plugin !== "semics-events") return;
		await request.get(`${EVENTS}/public/events`);
	}
	throw new Error(`cron task ${task} is not scheduled`);
}

/** The delivered email to `to` whose subject matches, draining the events outbox until it arrives. */
export async function mailTo(request: APIRequestContext, to: string, subject: RegExp, plugin = "semics-events"): Promise<Mail> {
	for (let tick = 0; tick < 30; tick++) {
		const { messages } = (await (await request.get(`/e2e/mail?to=${encodeURIComponent(to)}`)).json()) as {
			messages: Mail[];
		};
		const found = messages.find((m) => subject.test(m.subject));
		if (found) return found;
		await runCron(request, "outbox-drain", plugin);
	}
	throw new Error(`no email "${subject}" to ${to}`);
}

/** Every delivered email to `to` (no drain). */
export async function mailbox(request: APIRequestContext, to: string): Promise<Mail[]> {
	const { messages } = (await (await request.get(`/e2e/mail?to=${encodeURIComponent(to)}`)).json()) as { messages: Mail[] };
	return messages;
}

/** The first link in an email's text whose path starts with `prefix`, as a same-site path. */
export function linkIn(mail: Mail, prefix: string): string {
	for (const [raw] of mail.text.matchAll(/https?:\/\/\S+|\/\S+/g)) {
		const url = new URL(raw, "http://site.invalid");
		if (url.pathname.startsWith(prefix)) return `${url.pathname}${url.search}`;
	}
	throw new Error(`no ${prefix} link in "${mail.subject}"`);
}

/** A unique address per run. */
export const address = (who: string) => `${who}-${Date.now().toString(36)}@example.com`;
