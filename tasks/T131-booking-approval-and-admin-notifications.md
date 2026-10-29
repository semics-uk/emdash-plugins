---
id: T131
title: "Events: optional booking approval and admin notifications"
phase: 7
package: events
edition: free
status: review
model: opus-5.5
size: L
depends_on: []
spec: []
---

# T131 · Events: booking approval and admin notifications

## Definition

Per event: `approval: { required: boolean, deadlineHours (default 48) }`. A new booking status
`awaiting_approval` (in `src/domain/booking-state.ts`) that keeps the places reserved until approved,
declined or the deadline passes; the deadline is the earlier of created + `deadlineHours` and the
occurrence start. It comes after any signature/payment steps (with Pro payments, T132 makes payment a
hold; until then a paid booking waiting approval is refunded on decline). Expiry is handled by the
existing sweep (guarded `updateIf`, `releaseClaimedAt: null`), releasing inventory like a lapsed hold.

Admin: Approve and Decline (optional reason) on the Bookings page and as admin routes; the admin email's
buttons link into the admin, so only signed-in staff can act (no tokens in mail). Settings:
`adminNotifyEmails` (list) and `notifyAdminOn` (`requests` | `all bookings` | off). Admin notification
also works without approval. Customer emails: request received, confirmed (existing confirmation with
ICS), declined/expired. All through the existing outbox. Public booking page shows "Awaiting approval".
Free sites without payments get the same flow.

## Acceptance criteria

- [x] Tests first: state graph (new transitions, guards), deadline (capped at start), sweep expiry releases places, approve/decline races (double click, approve after expiry), cancel while awaiting
- [x] Admin approve/decline routes and Bookings page buttons; admin and customer emails via the outbox; call budgets
- [x] Settings and panel fields; booking page status; i18n strings
- [x] Interplay with waivers, waitlist offers and Pro Stripe confirm covered (paid + approval: refund on decline until T132)
- [x] Free Events backend is at 124.1 of its 125 KiB budget (R94): trim first (R94 names candidates: E-sign/protocol messages pulled in by `ERROR_CODES` ~1.5 KiB, admin help texts); never past 125
- [x] Free bundle within budget; decision recorded (next R); CONTEXT.md, README updated; changeset (minor)
- [x] Meets the Definition of Done

## Notes

- Runs in parallel with T129 (schedules) in the same package: stay out of `src/cron/occurrences.ts` and the schedule config; rebase often.
- Decision R97 (R95/R96 were taken by T133/T130). Backend 127,810 B of 128,000 (124.8 KiB, 190 B left) after rebasing on T130.
- Deviation: approve/decline are actions of the private `admin` route (`bookings.approve` value = booking id;
  `bookings.decline:<id>` form with `reason`), not separate `bookings/approve|decline` routes: those cost 425 B the
  budget did not have. They are admin-only (host auth) and budget-tested in `tests/approval.runtime.test.ts`.
- Trims (R97): Events answers from `EVENTS_ERROR_CODES` via `routeErrorFrom` (shared registry built from plain-data
  groups, -1.3 KiB; Pro must call `useErrorCodes(ERROR_CODES)` from `seams` if its steps answer e-sign/protocol codes
  other than TOKEN_INVALID/TOKEN_EXPIRED/REF_UNKNOWN/LICENCE_*, else they answer INTERNAL); the Event editor admin page
  renders the Tickets & booking panel (block ids `event:<id>:<n>` route `panel.*` actions back) instead of its own
  status/capacity/price editor (-1.5 KiB; other collections get the full panel, no waiver step there); booking status
  filter from `BOOKING_TRANSITIONS`; shorter admin/email texts (tests updated where they quoted them).
- Panel: one number field "Approval hours (0: no approval)" stands for `{ required, deadlineHours }`.
- Paid + approval: Free's receipt and continue settle through `settle`; Pro's Stripe confirm still confirms directly
  until it calls `settle` (T132). Decline of a paid request refunds through `AdminSteps.refund` (Free refuses it);
  an expired paid request is not refunded automatically (T132 makes payment a hold).
- Outbox kinds: `approval_requested`, `approval_expired` (due at the deadline; retried while still waiting, dropped
  once decided), `approval_declined`, `approval_admin`. The decline reason is stored on the booking (`declineReason`);
  retention does not erase it yet (follow-up).
- Pages removed blocks: `event.save`/old editor; `/events` "Edit" now opens the panel.
