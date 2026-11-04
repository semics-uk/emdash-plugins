---
id: T154
title: "Free sites: ask for esign/catalog-request once, not on every Refresh"
phase: 7
package: events-suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T150]
spec: []
---

# T154 · Quiet catalogue request on Free

## Definition

From T150: on Free Events the pair page asks for the Pro-only `esign/catalog-request` on every
pairing and Refresh templates click, and the host logs "Route not found" each time. Remember the
miss for the life of the site process (installing Pro restarts it).

## Acceptance criteria

- [x] A test failed first: on Free, two Refresh clicks after pairing make one route call.
- [x] Pro still fetches the catalogue on every pairing and Refresh (T150 tests pass).
