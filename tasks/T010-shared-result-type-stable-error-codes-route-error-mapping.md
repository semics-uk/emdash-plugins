---
id: T010
title: "Shared: result type, stable error codes, route error mapping"
phase: 1
package: shared
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T003]
spec: [BUILD-PLAN §4 result.ts]
---

# T010 · Shared: result type, stable error codes, route error mapping

## Definition

A typed `Result` and a registry of stable error codes (`HOLD_EXPIRED`, `SOLD_OUT`, `TOKEN_INVALID`, …) with mapping to HTTP status and user-safe messages.

## Model

**Sonnet 5.5**: Plain typed module.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Each error code maps to exactly one status and message
- [x] Unknown errors map to 500 without leaking the message
- [x] Codes are unique (test enumerates the registry)

## Implementation (green, then refactor)

- `packages/shared/src/result.ts`

## Acceptance criteria

- [ ] Used by both cores' route handlers (deferred: cores intentionally untouched here; adopt in the route tasks)
- [x] Meets the Definition of Done in `tasks/README.md` (changeset n/a: shared is private)

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- Registry is `ERROR_CODES` in `packages/shared/src/result.ts` (frozen; code -> `{ status, message }`), grouped by area. All protocol §9 codes plus `TEMPLATE_NOT_FOUND`, `REF_UNKNOWN`, `RATE_LIMITED` are included; a test parses the spec so they cannot drift.
- Booking-token codes are prefixed (`BOOKING_TOKEN_INVALID`, `BOOKING_TOKEN_EXPIRED`) to avoid clashing with the protocol's `TOKEN_*`; the e-sign signer link uses `SIGNING_TOKEN_*`. E-sign and payment statuses/messages (`ENVELOPE_*`, `PAYMENT_FAILED` 402) are my choices; later tasks may add codes.
- `toRouteError` accepts a code string, `{ code }` or an Error with `code`; anything else is 500 `INTERNAL`.
