---
id: T134
title: "Events: Pay now keeps the attendees typed at checkout; booking_from per widget"
phase: 7
package: events
edition: free
status: ready
model: opus-5.5
size: S
depends_on: [T136]
spec: [R98, R96]
---

# T134 · Events: Pay now keeps attendees

## Definition

R98's Pay now (a held payment the bank refused at approval) resumes through Free's
`public/checkout/continue`, which re-plans a non-waiver booking's attendees in the buyer's name (T077
resume), so names typed at checkout are lost. A resume of a booking that already has attendees must keep
them (and their waiver/signature state) and only re-run the payment step. Also from T130: the picker's
`booking_from` query parameter applies to every picker on a page; scope it per widget (e.g. keyed by the
widget/event id) with the no-JS links still working.

## Acceptance criteria

- [ ] Tests first: Pay now resume keeps attendee names, emails, minors and signature state; the original T077 resume (no attendees yet) is unchanged; Pro holds editions test covers Pay now end to end
- [ ] Two pickers on one page page independently, with and without JavaScript
- [ ] Free bundle within budget (after T136's headroom); CONTEXT.md; changeset (patch)
- [ ] Meets the Definition of Done
