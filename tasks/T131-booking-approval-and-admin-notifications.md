---
id: T131
title: "Events: optional booking approval and admin notifications"
phase: 7
package: events
edition: free
status: ready
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

- [ ] Tests first: state graph (new transitions, guards), deadline (capped at start), sweep expiry releases places, approve/decline races (double click, approve after expiry), cancel while awaiting
- [ ] Admin approve/decline routes and Bookings page buttons; admin and customer emails via the outbox; call budgets
- [ ] Settings and panel fields; booking page status; i18n strings
- [ ] Interplay with waivers, waitlist offers and Pro Stripe confirm covered (paid + approval: refund on decline until T132)
- [ ] Free bundle within budget; decision recorded (next R); CONTEXT.md, README updated; changeset (minor)
- [ ] Meets the Definition of Done

## Notes

- Runs in parallel with T129 (schedules) in the same package: stay out of `src/cron/occurrences.ts` and the schedule config; rebase often.
