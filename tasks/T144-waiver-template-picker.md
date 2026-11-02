---
id: T144
title: "Waiver template stays a text box after Refresh templates; E-sign never shows template ids"
phase: 7
package: esign
edition: pro
status: in-progress
model: opus-5.5
size: S
depends_on: []
spec: []
---

# T144 · Waiver template picker

## Definition

On LMSC staging (Events Pro and E-sign paired by hand), "Refresh templates" then a reload still shows
"Waiver template id (E-sign)" as a text box. `waiverFields()` in `packages/events/src/admin/panel.ts`
renders a select only when `waivers.templates` (the Pro catalogue cached by the last refresh, T066) is
non-empty, so the refresh never filled that cache, or it filled a cache the panel doesn't read. The
refresh opens an external link ("Fetch the templates from E-sign"); follow that flow end to end in
events-pro and E-sign and find where the catalogue gets lost. Separately, E-sign's Templates list and
edit page never show a template's id, so an admin can't even type it: the owner had to read it from
`_plugin_storage`.

## Acceptance criteria

- [ ] A test fails today: after the refresh flow completes (paired, licensed, one template in E-sign),
      the panel's waiver field is a select listing that template.
- [ ] Fixed at the cause (named in the report), not by re-fetching on every panel render.
- [ ] E-sign's Templates table has an ID column and the template edit page shows the id (copyable text).
- [ ] Do not edit `packages/events/src/admin/panel.ts` (T141/T142 are changing it); if the fix needs
      it, report the needed change instead.
