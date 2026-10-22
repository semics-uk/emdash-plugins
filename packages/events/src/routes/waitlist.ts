import { type RateLimitStore, rateLimit, type TurnstileFetch } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { parseJoinInput, planCheckout } from "../domain/checkout";
import type { EventConfigDoc, WaitlistDoc } from "../storage/schema";
import { type RedeemDeps, redeemBooking } from "./redeem";
import { badRequest, botCheck, fail, httpFetch } from "./reply";

/**
 * `POST public/waitlist/join` and `POST public/waitlist/claim` (EV-FR-16, EV-US-6, T081).
 *
 * Join: Turnstile (when a secret is set) and the shared per-IP `rateLimit` (KV, salted IP hash) →
 * one place per person, event and date. The answer is `{ ok: true }` whether or not the person was
 * already on the list, so it says nothing about anyone. 7 bridge calls: settings ∥ config, the limit's
 * read and write ∥ `siteverify`, the person's entries, the write (6 without Turnstile).
 *
 * Claim: the emailed offer link's one-time code for a fresh access token, exactly like
 * `public/booking/redeem` (R34) but only for a held waitlist offer; the entry becomes `claimed`. The
 * page then continues the booking with that token. 3 calls.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];

/** Joins one connection may make in ten minutes. */
export const JOIN_LIMIT = { scope: "waitlist", limit: 5, windowSeconds: 600 } as const;

type Where = Record<string, unknown>;

export interface JoinDeps {
	storage: {
		event_configs: { get(id: string): Promise<unknown> };
		waitlist: {
			query(o: { where: Where; limit: number }): Promise<{ items: Array<{ data: unknown }> }>;
			put(id: string, data: WaitlistDoc): Promise<unknown>;
		};
	};
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	kv: RateLimitStore;
	fetch: TurnstileFetch;
	ip: string | null;
	now: number;
	/** Salt for the IP hash when no Turnstile secret is set (the plugin id). */
	saltFallback: string;
	newId?: () => string;
}

export async function joinWaitlist(d: JoinDeps, raw: unknown): Promise<unknown> {
	const parsed = parseJoinInput(raw);
	if (!parsed.ok) return badRequest(parsed.error);
	const input = parsed.value;
	const [entries, stored] = await Promise.all([d.settings.list(), d.storage.event_configs.get(input.eventId)]);
	const c = stored as EventConfigDoc | null;
	if (!c?.waitlistEnabled || c.orphaned || c.unpublished) return fail("NOT_FOUND");
	// The order an offer would place (any listed type when none is named): a date or type that does
	// not exist, or a quantity the type never sells, could never be offered. Sold out is the point.
	const occ = input.occurrenceId;
	const tt = input.ticketTypeId;
	const types = c.catalog?.ticketTypes ?? {};
	const line = { ticketTypeId: tt ?? Object.keys(types).find((id) => !types[id]?.hidden) ?? "", qty: input.qty };
	const planned = planCheckout(input.eventId, c, { ...input, lines: [line], buyer: input, idempotencyKey: "" }, d.now, {
		maxSteps: 3,
	});
	if (!planned.ok && planned.error.code === "SALES_CLOSED") return fail("SALES_CLOSED");
	if (!planned.ok && planned.error.code === "BAD_REQUEST") {
		const reason = planned.error.reason;
		return badRequest([{ path: reason.includes("OCCURRENCE") ? "occurrenceId" : "ticketTypeId", code: reason }]);
	}

	const { secret, human: check } = botCheck(entries, d.fetch, input.turnstileToken, d.ip);
	const [limited, human] = await Promise.all([
		rateLimit(d.kv, d.ip ?? "unknown", d.now, { ...JOIN_LIMIT, salt: secret || d.saltFallback }),
		check,
	]);
	if (!limited.ok) return fail("RATE_LIMITED");
	if (!human.ok) return fail("TURNSTILE_FAILED");

	const { items } = await d.storage.waitlist.query({
		where: { eventId: input.eventId, email: input.email },
		limit: 20,
	});
	const queued = items.some(({ data }) => {
		const e = data as WaitlistDoc;
		return (e.status === "waiting" || e.status === "offered") && e.occurrenceId === occ;
	});
	if (!queued) {
		await d.storage.waitlist.put(d.newId?.() ?? `wl_${crypto.randomUUID()}`, {
			eventId: input.eventId,
			...(occ !== undefined ? { occurrenceId: occ } : {}),
			...(tt !== undefined ? { ticketTypeId: tt } : {}),
			email: input.email,
			name: input.name,
			qty: input.qty,
			status: "waiting",
			createdAt: new Date(d.now).toISOString(),
		});
	}
	return { ok: true };
}

type Handler = (routeCtx: { input?: unknown; requestMeta?: { ip: string | null } }, ctx: PluginContext) => unknown;

export const WAITLIST_ROUTES: Record<string, RouteDef> = {
	"public/waitlist/join": {
		methods: ["POST"],
		public: true,
		handler: ((routeCtx, ctx) =>
			joinWaitlist(
				{
					storage: ctx.storage as unknown as JoinDeps["storage"],
					settings: ctx.settings,
					kv: { get: (key) => ctx.kv.get<string>(key), set: (key, value) => ctx.kv.set(key, value) },
					fetch: httpFetch(ctx),
					ip: routeCtx.requestMeta?.ip ?? null,
					now: Date.now(),
					saltFallback: ctx.plugin.id,
				},
				routeCtx.input,
			)) as Handler as never,
	},
	"public/waitlist/claim": {
		methods: ["POST"],
		public: true,
		handler: ((routeCtx, ctx) =>
			redeemBooking({ storage: ctx.storage as unknown as RedeemDeps["storage"], now: Date.now() }, routeCtx.input, {
				claim: true,
			})) as Handler as never,
	},
};
