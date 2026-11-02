---
id: T145
title: "Suite pairs Events with E-sign automatically on the same site"
phase: 7
package: events-suite
edition: free
status: review
model: opus-5.5
size: M
depends_on: [T144]
spec: []
---

# T145 · Suite auto-pairing

## Definition

Today pairing Events with E-sign needs an admin to generate the E-sign master key, create an
integration client, copy a one-time secret, and paste the pairing string into Events settings. For a
non-technical club owner that is the hardest setup step. The owner asked for the suite to do it: when
Events and E-sign are both installed on one site, the suite creates the integration client and stores
the pairing string in Events itself.

First establish what the sandbox allows (can the suite, or one plugin, create a client in another
plugin's storage or call its admin route with the admin's session?). Pick the design that keeps the
one-time secret off screens and logs and keeps the existing manual flow working. If the platform can't
do it at all, ship the next best thing (one admin button: "Pair with E-sign on this site") and record
why.

## Acceptance criteria

- [x] Design and the sandbox facts behind it written in the task report and CONTEXT.md.
- [x] A test fails today: a fresh site with Events, E-sign and the suite reaches "paired" with at most
      one admin click and no copy-paste.
- [x] The secret is never shown, logged or returned to the browser; the manual flow still works;
      re-running pairing is idempotent (no duplicate clients).
- [x] Unpairing or removing E-sign leaves Events in the "pairing" waiver state, not broken.

## Notes

**Sandbox facts** (EmDash 1.2.0, read from `emdash/dist`; written into `packages/events-suite/CONTEXT.md`):

- A sandboxed core reaches only its own settings, storage and KV (scoped by plugin id) and has no way to
  call another plugin's routes. So neither Events nor E-sign can create a client in, or write a setting of,
  the other.
- Site pages are native code. For a signed-in visitor `locals.emdash` carries `handlePluginApiRoute`,
  which runs any route of a plugin (private ones too) in process with the caller the page passes. It
  skips the HTTP dispatcher's `plugins:manage` and CSRF checks, so the callee or caller must check.
  Anonymous visitors get only `handlePublicPluginApiRoute`.
- The host's plugin-settings handler (`GET`/`PUT` in `emdash/internal/routes/api/admin/plugins/_id_/settings`)
  checks `plugins:manage` on `locals.user`, validates against the manifest, encrypts secrets and merges
  only the keys sent (`null` deletes). Its answers mask secrets (`secretsSet`). A suite page can run it
  in process with the admin's `locals`.
- The sandbox strips `cookie`, `authorization` and `x-emdash-request` from a route's request headers
  but keeps `origin` and `sec-fetch-*`.

**Design.** The suite page `/_events/pair` (administrators only, enforced by the host's settings read)
needs at most one click, **Pair with E-sign on this site**. On that POST the suite calls E-sign's new private route
`integrations/pair` in process as the admin. E-sign generates the master key if none is stored, then
reuses or creates one "Events on this site" client, whose id it keeps in E-sign KV. The secret is derived,
so a repeat returns the same string: idempotent. The suite then writes the string into Events'
`esignPairing` through the host's own settings write, which encrypts it. The string exists only in that
request's memory. E-sign also refuses non-admin callers and any request with `Origin`/`Sec-Fetch-*`, so
an admin's browser cannot fetch a pairing string from the route either. Unpair revokes the client and
deletes the setting, which puts Events in the "pairing" state. When the host reports E-sign absent
("Plugin not enabled/found"), opening the page clears a leftover pairing. The manual flow is untouched.
No GET pairs automatically: one explicit, CSRF-checked click is safer than a state change on GET.

**Events change.** Only the panel's "pairing" hint text changed, to
"Use /_events/pair or add the E-sign pairing string in settings." It is 2 bytes shorter than the old
text, so it costs no hotfix room. No logic was added to Events.

**Residual / for reviewers.**
- Removing E-sign is detected only when an admin opens `/_events/pair`. The Events core cannot see
  other plugins, so until then a Pro site with a stale pairing sends bookings to the existing
  `SIGNING_UNAVAILABLE` retry page. Nothing crashes.
- Two concurrent first-time pair clicks could create two clients. KV has no compare-and-set. The
  second click's client wins in KV, and the other row can be revoked from Integrations.
- A non-browser client holding an admin session or API token, with the browser headers left off, could
  still get a pairing string from the route. That is the same exposure as `client.create` for the same admin.
- The page imports the host's internal settings route module (`emdash/internal/routes/*`, an exported
  subpath). If EmDash moves it, `pnpm verify` (playground typecheck/build) and the e2e test catch it.
- E2E: `apps/playground/e2e/t145-auto-pairing.spec.ts` signs in through the real magic-link flow. The
  session cookie is `Secure`, and Playwright's API client does not send it to http://127.0.0.1, so the
  signed-in replays run as `fetch` in the page.
