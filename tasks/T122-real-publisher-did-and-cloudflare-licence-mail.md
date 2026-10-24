---
id: T122
title: "Real publisher DID and domain; licence email through Cloudflare Email Service"
phase: 6
package: suite
edition: pro
status: done
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

- [x] R86 and R87 recorded in `BUILD-PLAN.md` §12; R21 points at R86
- [x] Every `emdash-plugin.jsonc` (and fixture) has the real DID, `https://semics.co.uk` and `security@semics.co.uk`; no tracked file in either repo mentions the old handle or the placeholder DID (tests first)
- [x] `release-dry-run` requires the real DID (`--require-real-did`, `--release`); its tests and the workflow tests pass
- [x] The licence Worker mails through the `EMAIL` send_email binding with no API key (tests first, with a fake binding); a send failure still makes Paddle retry
- [x] `MAIL_API_KEY` is gone from code, config, tests and docs; `MAIL_FROM` and `SUPPORT_EMAIL` use semics.co.uk
- [x] `tasks/reviews/release-1.0.md` owner steps: publisher identity done (R86), onboard `semics.co.uk` in Cloudflare Email, Email Sending, and no `MAIL_API_KEY` secret
- [x] Meets the Definition of Done

## Notes

- Public repo: manifests, fixtures, SECURITY, listing security pages, the FAQ, workflows, CONTRIBUTING and
  the release review name the real DID and semics.co.uk. `release-dry-run.mjs` exports `PUBLISHER_DID` and
  treats any other publisher as the release blocker (`--require-real-did`, `--release`). A test greps every
  tracked file for the old handle and the placeholder DID.
- Pro repo (branch `agent-t121`): `cloudflareMailer(env.EMAIL, MAIL_FROM, SUPPORT_EMAIL)` calls
  `EMAIL.send({ from: { name, email }, to, replyTo, subject, text })` (MAIL_FROM is parsed into name and
  address); a failed send throws, so the webhook answers 500 and Paddle retries, and a stuck-event alert
  stays for the next tick (existing tests). `wrangler.jsonc` has `"send_email": [{ "name": "EMAIL" }]` with no
  destination restriction. Tests replace the binding with a fake that records mails; no test makes an HTTP
  mail call. The Paddle fixture's checkout URL moved to semics.co.uk too. A Pro script test greps for the
  old handle, the placeholder DID and the `.example` domain.
- Not done here (owner): `emdash-plugin login semics.co.uk` and diffing `release setup --force` against the
  hand-written `emdash-release.yml`; onboarding semics.co.uk in Cloudflare Email Sending; `wrangler deploy`.
  The full `release-dry-run` was not run (it needs built packages); its unit tests and the workflow tests pass.
