---
id: T150
title: "Refresh templates: fetch in one step, or make the next step obvious"
phase: 7
package: events-suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T145]
spec: []
---

# T150 · Refresh templates in one step

## Definition

From LMSC staging after T144. Pressing "Refresh templates" on the panel only shows a link button,
"Fetch the templates from E-sign", which the admin must open; the opened page says "One template
loaded"; the admin must then reload the panel. The reviewer read the panel response as "nothing
happened" twice. The link exists because sandboxed Events can't call E-sign; the suite page can
(T066, and T145 showed suite pages can call plugin routes in process as the admin).

Make it one step where the platform allows: e.g. pairing on `/_events/pair` also loads the
catalogue, and the suite's templates page returns the admin to the event panel when done. Where a
click on a link is unavoidable, the panel says plainly what to do and the opened page links back.

## Acceptance criteria

- [x] A test fails today: after pairing on `/_events/pair`, the panel's waiver field is a select of
      the integration templates without pressing Refresh.
- [x] Refresh still works for templates added later, with clear wording on the panel response and a
      link back from the templates page.
- [x] No pairing secret or catalogue token in logs or URLs beyond what T066 already carries.

## Notes

- One step where the platform allows: pairing on `/_events/pair` now also loads the catalogue, and the
  paired page has a "Refresh templates" button (`action=templates`) for templates added later. Both call
  the suite's new `loadCatalogue`: Events Pro's new private `esign/catalog-request` (Pro repo, admin-only,
  1 settings read) mints the request in process for the signed-in admin, then the existing
  `refreshCatalogue` runs. The request never leaves the server; the PRG carries only a count or error code.
- The panel's link stays (sandboxed Events still cannot call E-sign); its answer now reads "Step 1: fetch
  the templates" / "Step 2: reload this panel and pick one" (shorter than before; Events bundle-size test
  green). `/_events/templates` says "Step 2: go back to the event and reload its panel" and links back to
  `/_emdash/admin/content/events` (the panel's collection) and to `/_events/pair`. A link to the exact
  event would need the event id in the Free panel's `refresh()` call (Events bytes); not done.
- Free Events has no `esign/catalog-request`: the host answers ROUTE_ERROR "Route not found" and logs one
  "Sandboxed plugin route error" line per pair / refresh click (no values in it). The suite maps it to
  `NOT_FOUND`; the pair page says waiver templates need Events Pro.
- Pro: worktree `/Users/semics/code/semics/.pro-worktrees/agent-ab8ef5af6f82d1d93`, branch
  `pro-agent-ab8ef5af6f82d1d93` (test + feat commits). Its T150 test imports the suite's `pairAction`
  from the public checkout, so land the public branch first.
- Tests: `packages/events-suite/tests/pair.test.ts` (T150 x3), `packages/events/tests/admin/panel-waivers.test.ts`
  (T150), e2e "T150 …" in `t145-auto-pairing.spec.ts`, Pro `tests/catalogue-e2e.editions.test.ts` (T150 x2:
  after `pairAction`, the panel's waiver field is a select of the template; route admin-only / needs pairing).
