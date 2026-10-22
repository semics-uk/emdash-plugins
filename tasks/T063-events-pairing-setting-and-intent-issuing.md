---
id: T063
title: "Events: pairing setting and intent issuing"
phase: 3
package: events
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: [T057, T012, T071]
spec: [EV-FR-12, R5]
---

# T063 · Events: pairing setting and intent issuing

## Definition

`esignPairing` secret setting; issue intents for the buyer (self and minors) inline and for other adult attendees by email; cap intent expiry at the remaining hold.

## Model

**Opus 5.5**: Rules spanning booking state and protocol.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Buyer and minors get inline intents; other adults get email intents
- [ ] Intent expiry ≤ remaining hold
- [ ] Without pairing, the waiver toggle is disabled with a banner

## Implementation (green, then refactor)

- `src/domain/waivers.ts`

## Acceptance criteria

- [ ] Pro-gated (licence stub until T070)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
