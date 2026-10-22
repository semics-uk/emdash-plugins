---
id: T096
title: "E-sign Pro: MCP tools"
phase: 6
package: esign
edition: pro
status: done
model: sonnet-5.5
size: S
depends_on: [T067, T071]
spec: [ES-FR-21]
---

# T096 · E-sign Pro: MCP tools

## Definition

List templates, send for signature, envelope status, remind, void (destructive).

## Model

**Sonnet 5.5**: Thin wrappers.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Tools register with permissions
- [x] Void flagged destructive

## Implementation (green, then refactor)

- `src/mcp/*.ts`

## Acceptance criteria

- [x] Reuse route handlers
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- All code is in the Pro repo (`packages/esign-pro/src/mcp/{routes,tools}.ts`, tests `tests/mcp.editions.test.ts`), branch
  `pro-agent-t096`. The public repo only gains BUILD-PLAN R55 and a CONTEXT.md paragraph; Free is unchanged (105.0 KiB).
- Tools: `listTemplates`, `sendForSignature`, `getEnvelopeStatus`, `remindSigners`, `voidEnvelope` (the only `destructive`), on
  private routes `pro/mcp/*` that declare `plugins:manage` (R55: EmDash registers a plugin tool only when the route declares the
  tool's permission, and no Free route declares one). An editor gets 403 on every route; an admin is served.
- Reuse: Free `templates/list`, `envelopes/get` (document text dropped), `envelopes/void`; `pro/envelopes/send` for 2-10 signers;
  one signer = Free `envelopes/create` (route 5 calls with the gate) + one-shot `mcp-send-<id>` running Free `envelopes/send`
  (9 calls, as the route already is: create + send inline would be 12). `remindSigners` uses the reminders task's reminder,
  refactored out of the task's closure as `sendReminder` (one due signer per call, at most once an hour per signer; 8 calls).
- Licence: send and remind are gated (new work, like `pro/envelopes/send` and the reminders task); list, status, void are not.
- The schemas are JSON Schema (no Zod) on an object-literal default export of `src/plugin.ts`, so `emdash-plugin build` writes
  them to the manifest and strips them from `plugin.mjs`. Pro E-sign backend 190.1 KiB (was 187.9; ceiling 256).
- The test host cannot call MCP tools, so registration is tested on the built manifest (names, routes, permission equal to the
  route's, `destructive`) plus the routes' permission enforcement over the real dispatch.
- Uploaded PDF templates (T094) are not offered through `sendForSignature`; a follow-up could add them.
