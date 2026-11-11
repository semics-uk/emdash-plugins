---
id: T161
title: "Events bundle size: what fills backend.js, what EmDash allows, and the options before 1.0"
phase: 7
package: events
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T160]
spec: [R42, R43, R47, R51, R94, R100]
---

# T161 · Events bundle size options

## Definition

The Free Events backend keeps hitting its size limit. Investigation only, no product code changes:

1. Measure what fills the built `packages/events/dist/plugin.mjs` (registry name `backend.js`), by source
   module and area.
2. Find the registry and EmDash rules: whether 128 KiB is a per-file cap, whether a sandboxed plugin can ship a
   second backend module or a lazy-loaded chunk, whether two plugins can share storage or call each other, and
   what the trust contract and capabilities mean for a split. Cite the source of each answer.
3. Options with estimated bytes saved, effort, risk, and what changes for sites and Pro.
4. A recommendation and what it needs from Oli.

## Model

**Opus 5.5**: build-tool and platform investigation with measured numbers.

## Tests first (red)

None. No product code changed. The probe builds below used throwaway entry files that were deleted afterwards.

## Acceptance criteria

- [x] Bytes per module and area, and how they were measured
- [x] Each EmDash and registry rule cited to a file
- [x] Options (a) to (d) with bytes, effort, risk and impact, plus two extra options found along the way
- [x] A recommendation and the decision Oli needs to make

## Verify

```sh
node scripts/tasks.mjs
```

## Notes

### Short version (for Oli)

- **Where things stand.** Free Events is 123,871 bytes. The registry refuses anything over 131,072 bytes, so
  there are 7.2 KB left. Our own margin has 33 bytes left. The file grew by 26.5 KB in 20 days (97.4 KB after
  T118 on 22 Oct, 123.9 KB now), roughly 1.3 KB a day of feature work.
- **A second file is not possible.** EmDash loads exactly one backend file per plugin.
- **Splitting into two plugins is a bad fit.** Two plugins cannot read each other's data. The natural split
  (public booking about 47 KB, back office about 77 KB) needs bookings on both sides. Cron jobs and emails
  have no site code in between to pass the data along. It would be two products, with a data migration for
  live sites.
- **Shrinking in place gives 4 to 7 KB once.** The minifier has nothing more to give, there are no
  dependencies left to remove, and no translation tables are in the file. That buys a few weeks, not a fix.
- **Recommendation:** no split. At 1.0, freeze Free's backend features: fixes and small changes only. New
  features go to Pro, or to site-side code (Astro pages, the suite). Do one shrink pass to get the hotfix
  margin back. Ask EmDash to allow more than one backend module.
- **What I need from Oli:** a yes or no on "Free's backend is feature-frozen at 1.0; new features go to Pro or
  the site kit". If you'd rather keep adding features to Free, the other choice is "Free ships from npm only
  and leaves the registry once it no longer fits".

### 1. What fills `backend.js`

**Method.** I reran the plugin CLI's runtime build with the CLI's own options
(`@emdash-cms/plugin-cli@0.13.3` `dist/api.mjs:2700-2720`: tsdown 0.20.3, ESM, `platform: "neutral"`,
`minify: true`, `treeshake: true`, the same `noExternal` list), adding only `sourcemap: true`. The output is
123,871 bytes, the same as `dist/plugin.mjs` from `pnpm run build`. I then gave each byte of the minified file to
the source file its sourcemap segment points at (`source-map-js`). 123,853 bytes (99.99%) were mapped. The
scripts were scratch files and are not committed. To repeat this: copy the CLI's `build()` call and add
`sourcemap: true`.

**By area** (bytes of minified `backend.js`):

| Area | Bytes | Share |
|---|---:|---:|
| `src/domain` (inventory, config, checkout, holds, booking state, schedule, mapping, ...) | 29,615 | 23.9% |
| `src/routes` (checkout continue/reserve, booking, config, public events, ICS, attendees, ...) | 29,393 | 23.7% |
| `src/admin` (Block Kit pages, entry panel, schedule editor, ui, messages, csv) | 25,581 | 20.7% |
| `@semics-tech/shared`, inlined (rrule, ics, blockkit, tokens, result, time, outbox, ...) | 15,598 | 12.6% |
| `src/cron` (retention, sweep, waitlist, occurrences, schedule) | 11,301 | 9.1% |
| `src/emails` (outbox, confirmation) | 8,803 | 7.1% |
| `src/hooks` (page metadata, content) | 2,723 | 2.2% |
| `src/plugin.ts` | 634 | 0.5% |
| Dependencies (`emdash/plugin` helpers only; no zod, no `@emdash-cms/blocks`) | 164 | 0.1% |
| `src/storage` | 41 | 0.0% |
| **Total** | **123,871** | |

**Largest modules:** `admin/pages.ts` 10,238 · `admin/panel.ts` 8,969 · `domain/config.ts` 6,004 ·
`emails/outbox.ts` 5,848 · `domain/inventory.ts` 5,442 · `routes/checkout-continue.ts` 4,344 ·
`domain/checkout.ts` 4,302 · `admin/schedule.ts` 4,076 · `routes/booking.ts` 4,019 · `routes/config.ts` 3,944 ·
`cron/retention.ts` 3,428 · `routes/checkout-reserve.ts` 3,241 · `domain/holds.ts` 3,120 ·
`routes/public-events.ts` 3,011 · `emails/confirmation.ts` 2,955 · `shared/rrule.ts` 2,768 ·
`routes/ics.ts` 2,708 · `shared/ics.ts` 2,642 · `cron/sweep.ts` 2,629 · `domain/booking-state.ts` 2,568.

**By kind of content:**

- **i18n: 0 bytes.** `src/i18n` (`en.ts` 16.8 KB, `ar.ts` 22.7 KB of source) belongs to the Astro UI kit only.
  The sandboxed core answers with codes and ships no message table (R51, R58, `src/i18n/index.ts:1-4`), so
  stripping i18n saves nothing. I checked: no `src/i18n` module appears in the sourcemap.
- **String and template literals: 36,805 bytes (30%)** in 1,644 literals. By area: routes 9,265, admin 8,382,
  emails 7,370, domain 5,700, shared 5,212, hooks 2,163. **Prose** (literals with two or more spaced words, so
  English sentences) is 13,517 bytes: emails 4,220, admin 3,432, routes 2,776, shared 1,551, hooks 932,
  domain 606.
- **Repeated literals:** 5,169 bytes are second and later copies of the same string (`"string"` ×36,
  `"confirmed"` ×16, `"awaiting_approval"` ×8, `"NOT_FOUND"` ×10, `"INVALID_INPUT"` ×7, ...). The minifier
  cannot rename strings. Turning them into shared constants gets back about 40% of that once each declaration
  is paid for.
- **Property names** cannot be shortened, because they are storage fields and wire shapes: `status` (211 uses,
  1,266 bytes), `storage` 770, `eventId` 651, `occurrences` 594, `holdExpiresAt` 481, ...
- **Minifier headroom: none.** Running esbuild's minifier again over the output gives 124,048 bytes
  (+177). The CLI's options are fixed (T118). Gzipped, the file is 42,950 bytes, but the registry caps the
  uncompressed size.

**Probe builds** (same CLI options; a throwaway copy of `src/plugin.ts` with parts removed). These show how
much each area costs on its own, counting the code only it uses:

| Probe | `backend.js` | Saved |
|---|---:|---:|
| Full (today) | 123,871 | |
| Without the `admin` + `editor/tickets` routes (all Block Kit pages, widget, entry panel) | 91,013 | 32,858 |
| Without every private route (admin, editor, attendees, config) | 88,863 | 35,008 |
| Without the cron hook (sweep, outbox/emails, retention, waitlist offers, occurrences) | 96,161 | 27,710 |
| Public routes and content/metadata hooks only (no cron, no private routes) | 47,044 | 76,827 |

So the "public booking" core is about 47 KB and the "back office" (admin, cron, emails) is about 77 KB.

### 2. EmDash and registry rules

| Question | Answer | Source |
|---|---|---|
| Is 128 KiB per file? | Yes. Registry bundles allow 128 KiB per file, 256 KiB in total, 20 files (RFC 0001). The CLI checks this on `validate`/`bundle`/`publish`, and the site checks it again on registry install and update. | `@emdash-cms/plugin-cli@0.13.3` `dist/api.mjs:837-839` (`MAX_FILE_SIZE = 128 * 1024`), `:1040-1046` (`validateBundleSize`); `@emdash-cms/registry-verification@0.3.4` `dist/bundle.js:9-13`, `:145` (`BUNDLE_FILE_SIZE_EXCEEDED`) |
| Does it apply to npm installs (`sandboxed: [...]`)? | No. Config-declared installs are not size-checked. That is how Pro ships at 244 KiB. Free is published to both npm and the registry on every rc (`NEXT.md`, rc.8 to rc.10), so for Free the registry cap applies. | T118 Notes (`emdash@1.2.0` `src/astro/integration/virtual-modules.ts:660`); emdash-plugins-pro `README.md:371-376`; `.github/workflows/release.yml:80-85` |
| Can a plugin ship a second backend module or a lazy chunk? | **No.** The CLI copies only `plugin.mjs` into the bundle as `backend.js`, so any chunk from a dynamic `import()` would be dropped. Registry verification reads exactly `backend.js` (plus an optional `admin.js`). Both runners load one plugin module: the Cloudflare Worker Loader gets `{ "plugin.js": wrapper, "sandbox-plugin.js": code }`, and workerd gets the same pair plus an `emdash` shim. `admin.js` is for React admin code, which needs trusted mode (the CLI warns about `admin.entry`), so it cannot hold backend code. Workers forbid `eval`/`new Function`, and code embedded as a string would still count against the same file. | plugin-cli `dist/api.mjs:3011` (only `backend.js` + `manifest.json` staged), `:2737-2741`; registry-verification `dist/bundle.js:40-59`; `@emdash-cms/cloudflare@1.2.0` `dist/sandbox/index.mjs:662-668`; `@emdash-cms/sandbox-workerd@0.9.3` `dist/runner-*.mjs:2327-2340`, `:1408-1411`; `emdash@1.2.0` `dist/marketplace-*.mjs:140-150` |
| Can two plugins share storage? | **No.** Settings, KV and declared storage are scoped to the plugin and isolated by its runtime plugin ID. There is no capability that grants access to another plugin's data. | `apps/playground/.claude/skills/creating-plugins/references/storage.md:3-11`; `SKILL.md:79` |
| Can two plugins call each other? | **Only through the site.** A sandboxed plugin has no API to call another plugin. `network:request` is limited to `allowedHosts`, and a site's own host is not known when the plugin is published. Events and E-sign already work this way: the trusted Astro code calls each plugin's routes in-process (`astro/lib/call.ts`) and passes HMAC-signed tokens along, or the browser does it with redirects. Cron jobs and hooks run with no site code in between. | `docs/protocol/esign-intent-v1.md` §1; `packages/events/src/astro/lib/call.ts:57-90`; `sandbox-boundaries.md` |
| Trust contract and capabilities for a split | The 1.0 contract pins slug `semics-events`, 4 capabilities, 1 host, 13 public routes and 8 hooks. Adding any of them is a major that operators consent to again. A second plugin has its own slug, its own contract and its own consent, and starts with **empty storage**. Moving routes out of `semics-events` breaks sites that call them. Pro uses the same slug `semics-events` (it overlays Free), so Pro's contract follows whichever plugin keeps the slug. | `packages/events/trust-contract.json`; emdash-plugins-pro `packages/events-pro/emdash-plugin.jsonc:4` |

**Pro has its own ceiling.** Pro Events `dist/plugin.mjs` in the Pro checkout (main) is 249,833 bytes. That
leaves 12,311 bytes under pro-kit's 256 KiB per-file ceiling (`pro-kit/testing/structure.ts`, R43) and 12.3 KB
under the registry's 256 KiB total. There is also a 50 ms cold-start parse budget. Raising the ceiling is an
R43 decision. So "move it to Pro" has limited room too, and Pro bundles Free, so every Free byte is also a Pro
byte.

### 3. Options

| Option | Bytes saved | Effort | Risk | Sites | Pro |
|---|---|---|---|---|---|
| **(a) Shrink in place** | 4 to 7 KB once (estimate: shared constants for repeated codes ~2 KB; tighter admin page builders and messages ~1.5 to 3 KB; `domain/config.ts` validator ~1 to 2 KB). i18n 0, minifier 0, dependencies 0 (all measured). | M (one task, like T118) | Low: the behaviour suites guard it, but every refactor of checkout/config code risks small differences | None | Pro shrinks by the same amount |
| **(b) Second file or lazy chunk** | n/a | n/a | **Not possible** on EmDash 1.2 (§2). It needs an upstream change to the bundle format and both runners. | n/a | n/a |
| **(c) Split into two plugins** | Up to 77 KB moved out (back office) or 33 KB (admin only), measured. | XL | High | Two installs, two consents, a new slug. **Data migration**: the new plugin starts with empty storage and cannot read Events' storage, so bookings would need an export/import through site code. Cron and emails need bookings on both sides, and nothing can carry them between the two. In practice the boundary only works for features with their own data. None of today's big areas qualify. | Pro overlays one slug. A split means two Pro overlays or picking one, and two licence checks. |
| **(d) Keep moving features to Pro / suite / Astro** | Each feature that lands outside Free costs Free 0 bytes; often a small seam of 100 to 500 bytes stays in Free | S per feature | Low. The cost is product: Free has fewer features. | Nothing changes (same install) | Pro has 12 KB under its own ceiling, so Pro needs a shrink pass or an R43 decision soon |
| **(e) Free on npm only, off the registry** | Removes the 128 KiB cap (only a self-set ceiling and the CPU parse budget remain) | S | Low technically. We lose the registry listing and installs from it. | Registry installs would have to switch to npm (`sandboxed: [...]`) | None |
| **(f) Ask EmDash upstream** for a module map in `backend.js` bundles or a bigger per-file cap | Removes the cap if accepted | S for us (an issue/RFC); timing is up to them | Out of our control | None until it lands | Same |

Notes on (a): the T118 pass already took the easy wins (zod/mini 21 KB, PDF font tables 3.1 KB, duplicated
helpers). Moving the admin "Setup check" page to a CLI or site page is possible but not measured; a guess is 2 to
3 KB.

### 4. Recommendation

1. **No split, no second file.** (b) is impossible. (c) gives two products that cannot share bookings, a data
   migration for live sites, a second consent and two Pro overlays, for space that (d) gets for free.
2. **Freeze Free's backend at 1.0** (fixes and small changes only). New features go to Pro (A) or to
   site-side code (Astro components, the suite, `astro/lib`). This is not a breaking change, and it can be
   loosened later. Splitting after 1.0 would be breaking, so this decision keeps the future open.
3. **One shrink pass now** (new task, like T118): target 4 to 7 KB to restore the R100 4 KiB hotfix margin.
   A sensible add-on is a pass on Pro, which has 12 KB under its own ceiling.
4. **File an upstream EmDash request** for multi-module backends or a larger per-file cap. The Worker Loader
   already takes a module map; EmDash only uses two entries.
5. **Fallback:** if Free must keep growing, choose (e) over (c).

**Needs from Oli:** one yes or no: "Free's backend is feature-frozen at 1.0; new features go to Pro or the site
kit." If no, choose between (e) "Free leaves the registry when it no longer fits" and accepting a split with a
data migration.
