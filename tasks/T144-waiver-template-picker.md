---
id: T144
title: "Waiver template stays a text box after Refresh templates; E-sign never shows template ids"
phase: 7
package: esign
edition: pro
status: done
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
- [x] E-sign's Templates table has an ID column and the template edit page shows the id (copyable text).
- [x] Do not edit `packages/events/src/admin/panel.ts` (T141/T142 are changing it); if the fix needs
      it, report the needed change instead.

## Notes

- **No code defect found in the refresh flow, so the first two criteria are not met as written.** The whole
  flow was run end to end on the real bundles in workerd: Events Pro (licensed) and the Free E-sign core on one
  test database. E-sign was set up by hand through its admin (Generate key, `client.create`, `template.create`
  with "Available to integrations" on), and the pairing string went into the Events settings. Then the test
  pressed the panel's Refresh templates, ran the suite's own `refreshCatalogue` (imported from
  `packages/events-suite`) with both cores reached over the host's HTTP route dispatch
  (`actions.routes.request`, the same body parsing a real site uses), and reloaded the panel. The field is a
  select listing the template. Test: Pro `packages/events-pro/tests/catalogue-e2e.editions.test.ts` (branch
  `pro-agent-ac3fc377c37eb883a`). It passes today, so it guards against regressions; it is not a red test.
- Also checked and ruled out:
  - KV key and namespace: the public `esign/catalog` route and `editor/tickets` use the same plugin id, and the
    Cloudflare bridge and the workerd runner both key KV by plugin id.
  - The manifest marks `esign/catalog` public.
  - JSON body parsing for a route without a `request` declaration works (EmDash 1.2 and 1.3.1).
  - Template ids are UUIDs and pass both `TEMPLATE_ID` filters.
  - The admin's external link keeps the fragment.
  - Astro 7's origin check accepts `Sec-Fetch-Site: same-origin`.
  - The suite code vendored in LMSC (rc.0) is identical to `main`.
  - LMSC staging's `EMDASH_SITE_URL` is its own workers.dev origin.
- Most likely cause on LMSC staging (I could not read the staging data): the E-sign template is not marked
  "Available to integrations". The flag is off by default on the create form (a T061 decision). Then
  `public/templates/catalog` returns `[]`, the suite page in the new tab says "E-sign has no templates available
  to integrations yet", and the panel keeps the text box without saying why. To confirm: look at the
  Integrations column on E-sign's Templates page, or query D1 for the `_plugin_storage` rows `semics-esign` /
  `templates` (field `integrations`) and `semics-events` / `__kv` / `esign:catalog`.
- Change needed in `packages/events/src/admin/panel.ts` (not made; T141/T142 own the file): when
  `waivers.available` is true and `waivers.templates` is empty, add a context line under the text field, e.g.
  "No templates loaded. Press Refresh templates; only E-sign templates marked Available to integrations are
  listed." Then an empty catalogue is never silent.
- Done: E-sign's Templates table has an ID column, and the template editor shows the id in a code block (easy to
  copy) under a "Template id:" label. Test: `packages/esign/tests/admin.runtime.test.ts` "T144 …".
