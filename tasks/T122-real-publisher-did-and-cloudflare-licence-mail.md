---
id: T122
title: "Real publisher DID and domain; licence email through Cloudflare Email Service"
phase: 6
package: suite
edition: pro
status: in-progress
model: opus-5.5
size: S
depends_on: [T121]
spec: [R21, R86, R87]
---

# T122 · Real publisher DID and domain; licence email through Cloudflare Email Service

## Definition

Two owner decisions (2026-10-24).

**R86 publisher identity.** The publisher is the atproto account `did:plc:mire6xkehfirmoj5pmpqgpvq`, handle
`semics.co.uk` (PDS `https://auriporia.us-west.host.bsky.network/`). It replaces R21's placeholder DID
and the old `.dev` handle/domain everywhere in both repos (manifests,
fixtures, workflows, docs, CONTRIBUTING, `tasks/reviews/release-1.0.md`, tests). The release checks now
require that exact DID rather than refusing the placeholder.

**R87 licence email.** The Pro licence Worker (`packages/licence-worker`) drops Resend and sends through
Cloudflare Email Service: a Workers `send_email` binding (`EMAIL`, no destination restriction, so it can mail
any buyer; Workers Paid) called with the structured `send({ to, from, replyTo, subject, text })` builder.
`MAIL_API_KEY` goes from `env.ts`, the required-config check in `index.ts`, `wrangler.jsonc` and the docs.
`MAIL_FROM` is `semics <licences@semics.co.uk>`, `SUPPORT_EMAIL` is `support@semics.co.uk`; remaining
`semics.example` placeholders become `semics.co.uk`. The `Mailer` interface stays, so tests use a fake binding.

## Acceptance criteria

- [ ] R86 and R87 recorded in `BUILD-PLAN.md` §12; R21 points at R86
- [ ] Every `emdash-plugin.jsonc` (and fixture) has the real DID, `https://semics.co.uk` and `security@semics.co.uk`; no tracked file in either repo mentions the old handle or the placeholder DID (tests first)
- [ ] `release-dry-run` requires the real DID (`--require-real-did`, `--release`); its tests and the workflow tests pass
- [ ] The licence Worker mails through the `EMAIL` send_email binding with no API key (tests first, with a fake binding); a send failure still makes Paddle retry
- [ ] `MAIL_API_KEY` is gone from code, config, tests and docs; `MAIL_FROM` and `SUPPORT_EMAIL` use semics.co.uk
- [ ] `tasks/reviews/release-1.0.md` owner steps: publisher identity done (R86), onboard `semics.co.uk` in Cloudflare Email, Email Sending, and no `MAIL_API_KEY` secret
- [ ] Meets the Definition of Done
