---
id: T135
title: "Playground e2e: attendee signing list, approval and payment holds"
phase: 7
package: playground
edition: pro
status: done
model: opus-5.5
size: M
depends_on: []
spec: [R95, R97, R98]
---

# T135 · Playground e2e for the new booking features

## Definition

T133 (attendee list) and T132 (payment holds) were tested by unit and editions tests only. Add Playwright
specs in `apps/playground/e2e/` that run the real flows on the playground with the Pro builds (on a
`*.workers.dev`-style host or the playground's existing Pro setup) and Stripe faked the way existing
payment e2e specs do: (1) waiver booking → booking page lists attendees Signed / Waiting; Sign now signs
one on the same page; Resend; edit a name before the cutoff, refused after; no-JS variant. (2) approval
event, free booking → Awaiting approval → admin Approve → confirmed; Decline path; expiry via the sweeper.
(3) paid approval event → authorised hold → Approve captures; Decline releases; saved-card path with a
refused charge → Pay now → confirmed. (4) slot schedule + day/time picker booking end to end. Axe on the
new pages. Fix any bug found (test-first, in the owning package).

## Acceptance criteria

- [x] Specs for flows 1-4 pass locally; axe clean; 320 px layout
- [x] Bugs found are fixed test-first and listed in Notes
- [x] Meets the Definition of Done (both repos' `pnpm verify` if Pro code changes)

## Notes

- Specs: `apps/playground/e2e/t135-approval-holds.spec.ts` (flows 2, 3), `t135-attendee-list.spec.ts` (flow 1),
  `t135-schedule.spec.ts` (flow 4): 11 tests, all pass on the playground built with Events Pro (Pro `main` bc4a5ac, built
  in a Pro worktree, linked with `EMDASH_PRO_DIR`). They skip on the Free build (plain `pnpm --filter playground e2e`). How
  to run them and how Stripe is faked: `apps/playground/CONTEXT.md` (a preload in the server process sends api.stripe.com
  to a fake Stripe in the Playwright process; checkout completion is the signed webhook). Axe (WCAG 2.2 AA) and 320 px
  reflow on the booking page awaiting approval / awaiting payment, the attendee list and the slot picker.
- Bugs found, fixed test-first, both in `packages/esign` (changeset `esign-client-index-guardian-name`, patch):
  1. An integration client could create only one envelope on a real site: `clients.uniqueIndexes: ["clientId"]` becomes,
     in EmDash 1.2, `UNIQUE(plugin_id, collection, json_extract(data,'$.clientId'))` over all the plugin's storage, and
     envelopes carry `clientId`, so a client's second envelope failed with a UNIQUE constraint error (unit hosts don't
     enforce unique indexes). Dropped the index (manifest storage change; EmDash's `syncStorageIndexes` drops the orphaned
     index on upgrade); `getClient` reads the client by document id (= client id). Guard: `tests/storage-host.test.ts`
     "no unique field is a field of another collection's documents". Events' unique fields collide with nothing.
  2. The guardian ceremony said "Signing as guardian for [object Object]": `public/session` returned the stored
     `participant` object; it now returns the name (`tests/from-intent.routes.test.ts`, T135 test).
- No Pro code changed (the Pro worktree `pro-agent-a1fc56a578ad718ff` holds only a build; nothing to land). After landing,
  Pro's `pnpm verify` composes the new e-sign manifest; no Pro source or test refers to the dropped index.
- As instructed, T134's gap is not touched: the Pay now test asserts the payment outcome only. The buyer's own flow signs
  the buyer then each child in turn on `/_events/waiver`, so the list starts Signed / Signed / Waiting and Sign now signs
  the emailed adult on the buyer's device.
- Follow-ups (not T135's): `/booking` lists a line as `3 × <ticket type id>` when ticket ids are UUIDs (BookingStatus gets
  no ticket names); on the Free run `t130-day-picker` "keyboard roves" fails when the fixture's days straddle a month end
  (today, 30 October, only one day is in the shown month) and the `t054` card snapshot is 3 px shorter on this machine;
  both fail without this task's changes.
