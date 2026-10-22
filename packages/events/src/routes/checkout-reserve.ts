import { generateToken, hashIp, hashToken, type TurnstileFetch } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type SweepCron, scheduleHoldTask } from "../cron/sweep";
import {
	bookingKeys,
	parseReserveInput,
	planCheckout,
	RESERVE_RATE_LIMIT,
	type ReserveInput,
	rateWindowStart,
	sameOrder,
} from "../domain/checkout";
import { extendHold, HOLD_STATUSES, holdSettings, startHold, stepTarget } from "../domain/holds";
import { type CounterCollection, reserve } from "../domain/inventory";
import { iso } from "../domain/time";
import type { BookingDoc, EventConfigDoc } from "../storage/schema";
import { badRequest, botCheck, fail, httpFetch, type PublicSettings } from "./reply";

/**
 * `POST public/checkout/reserve` (EV-FR-05, R9): Turnstile + rate limit → validate → write the
 * booking as `draft` → reserve the seats → mark it `held`. The access token is returned in the
 * response body only; its hash is stored.
 *
 * Bridge calls (R22: hard limit 10, design target 8), in order:
 * 1. `settings.list` ∥ `event_configs.get` (2). The config carries the ticket type and occurrence
 *    catalog, so no other reads.
 * 2. rate-limit `bookings.count` of this IP's recent bookings ∥ Turnstile `siteverify` (2; 1 when
 *    no Turnstile secret is configured, 2 again on the site's first booking, which stores the IP
 *    salt, T100). The bookings themselves are the rate-limit counter, so the limit costs one call;
 *    an IP is stored only as a salted hash.
 * 3. `bookings.compareAndSet(id, null, draft)` (1): create-only, so the idempotency key's booking
 *    id makes a resubmit find the first booking instead of reserving twice.
 * 4. `reserve`: one guarded write per step (ticket types, occurrence, event), at most what is left
 *    after keeping one call for step 5; a miss compensates within that budget and leaves the rest
 *    to the sweeper's drift repair (an over-count is the safe direction).
 * 5. `bookings.updateIf` draft → `held`, guarded on `releaseClaimedAt: null` and the status (1).
 * 6. The `hold-<ref>` accelerator only when it keeps the invocation within the target (the
 *    `sweep-holds` cron is the source of truth; `checkout/continue` re-arms it on each step).
 * A one-ticket-type order is 8 calls; an occurrence order with two ticket types is 10.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

export const RESERVE_MAX_CALLS = 10;
export const RESERVE_TARGET_CALLS = 8;

type Where = Record<string, unknown>;

export interface ReserveStorage {
	bookings: {
		get(id: string): Promise<unknown>;
		compareAndSet(id: string, expectedRevision: null, data: unknown): Promise<{ applied: boolean }>;
		updateIf(id: string, args: { where: Where; set?: Where }): Promise<{ applied: boolean }>;
		count(where: Where): Promise<number>;
	};
	event_configs: CounterCollection & { get(id: string): Promise<unknown> };
	ticket_types: CounterCollection;
	occurrences: CounterCollection;
}

export interface ReserveDeps {
	storage: ReserveStorage;
	settings: PublicSettings;
	fetch: TurnstileFetch;
	cron?: SweepCron;
	/** Client IP from the host's request metadata (null when unknown). */
	ip: string | null;
	now: number;
}

/** The event's waiver, copied onto the booking (only when it is required and names a template). */
export function waiverOf(config: EventConfigDoc): Pick<BookingDoc, "waiver"> {
	const sig = config.signature;
	return sig?.required && sig.templateId ? { waiver: { templateId: sig.templateId, mode: sig.mode } } : {};
}

interface Attempt {
	deps: ReserveDeps;
	input: ReserveInput;
	id: string;
	token: string;
	tokenHash: string;
	settings: Record<string, unknown>;
}

const success = (b: Pick<BookingDoc, "ref" | "status" | "totals">, token: string, holdExpiresAt: string) => ({
	ok: true as const,
	bookingRef: b.ref,
	accessToken: token,
	status: b.status,
	holdExpiresAt,
	totals: b.totals,
});

/**
 * A resubmit of an order whose booking already exists: answer with that booking and a fresh access
 * token (the first response may never have arrived), extending a running hold as a checkout step.
 * Every write is guarded on the status read and `releaseClaimedAt: null`; a miss means the hold
 * lapsed or moved on. A confirmed booking keeps its token (it was emailed). One call.
 */
async function resume(a: Attempt, existing: BookingDoc): Promise<unknown> {
	const { storage, now } = a.deps;
	if (HOLD_STATUSES.includes(existing.status)) {
		const until = stepTarget(now, { paid: existing.totals.totalMinor > 0 }, holdSettings(a.settings));
		const extended = await extendHold(storage.bookings, a.id, existing, now, until, { accessTokenHash: a.tokenHash });
		if (!extended.ok) return fail(extended.error.code === "CONFLICT" ? "INTERNAL" : "HOLD_EXPIRED");
		return success(existing, a.token, extended.value.holdExpiresAt);
	}
	if (existing.status === "draft" && !existing.releaseClaimedAt && Date.parse(existing.holdExpiresAt ?? "") > now) {
		// The first submit is still reserving: hand this one the booking it is creating.
		const { applied } = await storage.bookings.updateIf(a.id, {
			where: { status: "draft", holdExpiresAt: existing.holdExpiresAt, releaseClaimedAt: null },
			set: { accessTokenHash: a.tokenHash },
		});
		return applied ? success(existing, a.token, existing.holdExpiresAt ?? "") : fail("INTERNAL");
	}
	if (existing.status === "confirmed") return { ok: true, bookingRef: existing.ref, status: existing.status };
	return fail("HOLD_EXPIRED");
}

/** After a refusal, a resubmit of an existing booking still gets it (one read); otherwise the refusal. */
async function resumeOr(a: Attempt, refusal: unknown): Promise<unknown> {
	const existing = (await a.deps.storage.bookings.get(a.id)) as BookingDoc | null;
	return existing && sameOrder(existing, a.input) ? resume(a, existing) : refusal;
}

export async function reserveCheckout(deps: ReserveDeps, raw: unknown): Promise<unknown> {
	const parsed = parseReserveInput(raw);
	if (!parsed.ok) return badRequest(parsed.error);
	const input = parsed.value;
	const { storage, now } = deps;

	const [entries, stored] = await Promise.all([deps.settings.list(), storage.event_configs.get(input.eventId)]);
	const config = stored as EventConfigDoc | null;
	if (!config || config.orphaned || config.unpublished) return fail("NOT_FOUND");
	const bot = botCheck(entries, deps.settings, deps.fetch, input.turnstileToken, deps.ip);
	const settings = bot.settings;

	const ipHash = await hashIp(deps.ip ?? "unknown", bot.salt);
	const [recent, human] = await Promise.all([
		storage.bookings.count({ ipHash, createdAt: { gte: rateWindowStart(now) } }),
		bot.human,
	]);
	let calls = 2 + 1 + bot.calls;
	if (recent >= RESERVE_RATE_LIMIT.limit) return fail("RATE_LIMITED");

	const { id, ref } = await bookingKeys(input.idempotencyKey);
	const token = generateToken();
	const attempt: Attempt = { deps, input, id, token, tokenHash: await hashToken(token), settings };
	if (!human.ok) return resumeOr(attempt, fail("TURNSTILE_FAILED"));

	// Keep two calls: the draft write before reserving and the move to `held` after.
	const plan = planCheckout(input.eventId, config, input, now, { maxSteps: RESERVE_MAX_CALLS - calls - 2 });
	if (!plan.ok) {
		const e = plan.error;
		const path = e.code === "BAD_REQUEST" && e.reason.includes("OCCURRENCE") ? "occurrenceId" : "lines";
		return resumeOr(attempt, e.code === "BAD_REQUEST" ? badRequest([{ path, code: e.reason }]) : fail(e.code));
	}

	const hold = startHold(now, { paid: plan.value.paid }, holdSettings(settings));
	const draft: BookingDoc = {
		ref,
		eventId: input.eventId,
		...(input.occurrenceId !== undefined ? { occurrenceId: input.occurrenceId } : {}),
		status: "draft",
		...hold,
		releaseClaimedAt: null,
		buyer: { name: input.buyer.name, email: input.buyer.email },
		email: input.buyer.email,
		lines: plan.value.lines,
		totals: plan.value.totals,
		answers: {},
		...waiverOf(config),
		accessTokenHash: attempt.tokenHash,
		ipHash,
		createdAt: iso(now),
	};
	let created: { applied: boolean };
	try {
		created = await storage.bookings.compareAndSet(id, null, draft);
	} catch {
		// A duplicate `ref` (the unique index) from another key: astronomically rare; retry with a new key.
		return fail("INTERNAL");
	}
	calls++;
	if (!created.applied) {
		const existing = (await storage.bookings.get(id)) as BookingDoc | null;
		if (!existing) return fail("INTERNAL");
		return sameOrder(existing, input)
			? resume(attempt, existing)
			: badRequest([{ path: "idempotencyKey", code: "IDEMPOTENCY_KEY_REUSED" }]);
	}

	const reserved = await reserve(storage, plan.value.steps, { maxCalls: RESERVE_MAX_CALLS - calls - 1 });
	if (!reserved.ok) {
		// Close the draft: at once when every seat was given back; otherwise end its hold now so the
		// sweeper closes it after the draft grace period and repairs the event's counters.
		const set =
			reserved.error.uncompensated.length === 0
				? { status: "expired", expiredAt: iso(now) }
				: { holdExpiresAt: iso(now) };
		await storage.bookings
			.updateIf(id, { where: { status: "draft", releaseClaimedAt: null }, set })
			.catch(() => undefined);
		return fail(reserved.error.code === "SOLD_OUT" ? "SOLD_OUT" : "INTERNAL");
	}
	calls += plan.value.steps.length;

	const held = await storage.bookings.updateIf(id, {
		where: { status: "draft", releaseClaimedAt: null },
		set: { status: "held" },
	});
	calls++;
	// Claimed by an expirer meanwhile: it closes the draft and drift repair settles its seats.
	if (!held.applied) return fail("HOLD_EXPIRED");

	if (deps.cron && calls + 1 <= RESERVE_TARGET_CALLS) {
		await scheduleHoldTask(deps.cron, { id, ref, holdExpiresAt: hold.holdExpiresAt }).catch(() => undefined);
	}
	return success({ ref, status: "held", totals: plan.value.totals }, token, hold.holdExpiresAt);
}

export const CHECKOUT_RESERVE_ROUTE: RouteDef = {
	methods: ["POST"],
	public: true,
	handler: (async (routeCtx: { input?: unknown; requestMeta?: { ip: string | null } }, ctx: PluginContext) =>
		reserveCheckout(
			{
				storage: ctx.storage as unknown as ReserveStorage,
				settings: ctx.settings,
				fetch: httpFetch(ctx),
				...(ctx.cron ? { cron: ctx.cron } : {}),
				ip: routeCtx.requestMeta?.ip ?? null,
				now: Date.now(),
			},
			routeCtx.input,
		)) as Handler,
};
