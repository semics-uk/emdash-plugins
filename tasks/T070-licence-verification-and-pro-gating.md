---
id: T070
title: "Licence verification and Pro gating"
phase: 4
package: shared
edition: pro
status: backlog
model: opus-5.5
size: M
depends_on: [T011]
spec: [BUILD-PLAN §13, R17]
---

# T070 · Licence verification and Pro gating

## Definition

`licence.ts` verifies `semics1.` keys (Ed25519, hostname match, `updatesUntil` vs build date, local and preview hosts exempt) and a gating helper: no new paid work without a key, in-flight work continues.

## Model

**Opus 5.5**: Commercial security logic.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Valid key passes; wrong host, tampered or wrong product fails
- [ ] Build after `updatesUntil` asks for renewal; older build keeps working
- [ ] `localhost` and `*.workers.dev` exempt
- [ ] Gate blocks new paid checkout but allows refunds

## Implementation (green, then refactor)

- `packages/shared/src/licence.ts`, `gate.ts`

## Acceptance criteria

- [ ] Public key injected at build time
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
