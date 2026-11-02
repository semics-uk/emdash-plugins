---
id: T150
title: "Refresh templates: fetch in one step, or make the next step obvious"
phase: 7
package: events-suite
edition: free
status: backlog
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

- [ ] A test fails today: after pairing on `/_events/pair`, the panel's waiver field is a select of
      the integration templates without pressing Refresh.
- [ ] Refresh still works for templates added later, with clear wording on the panel response and a
      link back from the templates page.
- [ ] No pairing secret or catalogue token in logs or URLs beyond what T066 already carries.
