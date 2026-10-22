import { generateToken, hashToken, verifyToken } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type InputIssue, parseBookingAccessInput } from "../domain/checkout";
import type { BookingDoc } from "../storage/schema";
import { fail } from "./reply";

/**
 * `POST public/booking/redeem` (EV-US-3, EV-FR-08): exchanges the one-time code from the emailed
 * booking link for a fresh access token. The page that received `/booking?ref=<ref>&k=<code>` posts
 * `{ bookingRef, code }` here (from a button or the server, never from a link prefetch), keeps the
 * token in its HttpOnly cookie and drops `k` from the URL. The code is single use and expires
 * (`redeemExpiresAt`); redeeming replaces `accessTokenHash`, so a token issued earlier stops working.
 *
 * A wrong code, an unknown ref, an expired or already used code, and a lost race all answer the same
 * `NOT_FOUND`, and an unknown ref still pays for a hash check. 2 bridge calls: query, `updateIf`.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Item = { id: string; data: unknown };

export interface RedeemDeps {
	storage: {
		bookings: {
			query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: Item[] }>;
			updateIf(
				id: string,
				args: { where: Record<string, unknown>; set?: Record<string, unknown> },
			): Promise<{ applied: boolean }>;
		};
	};
	now: number;
}

const DECOY_HASH = "0".repeat(64);

function parse(raw: unknown): { bookingRef: string; code: string } | InputIssue[] {
	const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const extra = Object.keys(input).filter((k) => k !== "bookingRef" && k !== "code");
	const parsed = parseBookingAccessInput({ bookingRef: input.bookingRef, accessToken: input.code });
	if (!parsed.ok || extra.length > 0) {
		const issues = parsed.ok
			? []
			: parsed.error.map((i) => ({ ...i, path: i.path === "accessToken" ? "code" : i.path }));
		return [...issues, ...extra.map((path) => ({ path, code: "unrecognized_keys" }))];
	}
	return { bookingRef: parsed.value.bookingRef, code: parsed.value.accessToken };
}

export async function redeemBooking(deps: RedeemDeps, raw: unknown): Promise<unknown> {
	const input = parse(raw);
	if (Array.isArray(input)) return { ...fail("BAD_REQUEST"), issues: input };
	const { bookingRef, code } = input as { bookingRef: string; code: string };
	const { items } = await deps.storage.bookings.query({ where: { ref: bookingRef }, limit: 1 });
	const found = items[0];
	const booking = found?.data as BookingDoc | undefined;
	const stored = booking?.redeemHash ?? undefined;
	const matches = await verifyToken(code, stored ?? DECOY_HASH);
	const live = Date.parse(booking?.redeemExpiresAt ?? "") > deps.now;
	if (!found || !booking || !stored || !matches || !live) return fail("NOT_FOUND");
	const accessToken = generateToken();
	const swapped = await deps.storage.bookings.updateIf(found.id, {
		where: { redeemHash: stored },
		set: { accessTokenHash: await hashToken(accessToken), redeemHash: null, redeemExpiresAt: null },
	});
	if (!swapped.applied) return fail("NOT_FOUND");
	return { ok: true, bookingRef: booking.ref, accessToken };
}

export const BOOKING_REDEEM_ROUTE: RouteDef = {
	methods: ["POST"],
	public: true,
	handler: (async (routeCtx: { input?: unknown }, ctx: PluginContext) =>
		redeemBooking(
			{ storage: ctx.storage as unknown as RedeemDeps["storage"], now: Date.now() },
			routeCtx.input,
		)) as never,
};
