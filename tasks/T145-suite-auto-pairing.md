---
id: T145
title: "Suite pairs Events with E-sign automatically on the same site"
phase: 7
package: events-suite
edition: free
status: in-progress
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

- [ ] Design and the sandbox facts behind it written in the task report and CONTEXT.md.
- [ ] A test fails today: a fresh site with Events, E-sign and the suite reaches "paired" with at most
      one admin click and no copy-paste.
- [ ] The secret is never shown, logged or returned to the browser; the manual flow still works;
      re-running pairing is idempotent (no duplicate clients).
- [ ] Unpairing or removing E-sign leaves Events in the "pairing" waiver state, not broken.
