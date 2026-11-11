---
id: T162
title: "Events backend shrink pass: win back the hotfix margin; move text and templates out of the bundle where it pays"
phase: 7
package: events
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T161]
spec: [R42]
---

# T162 · Events backend shrink pass

## Source

T161 (`tasks/T161-events-bundle-size-options.md`) measured `packages/events/dist/plugin.mjs` at 123,871 bytes: 7.2 KB
under the registry's 128 KiB per-file cap, 33 bytes inside our 4 KiB hotfix margin. Oli's decision (2026-11-11): no
feature freeze and no split for now. Keep size in mind on every change, do a shrink pass now, and look at what could be
loaded from outside the bundle or kept in the database instead (templates and the like).

## Definition

1. **Shrink in place** (T161 §3a): shared constants for repeated literals (status names, error codes, `"string"`
   validators), tighter admin page builders and messages, the `domain/config.ts` validator, anything else the
   sourcemap breakdown shows. No behaviour change.
2. **Out of the bundle, measured first.** For each candidate, measure the bytes it would free and say whether it can
   work in a sandboxed plugin (one backend file, `network:request` limited to the trust contract's one host, no
   cross-plugin storage, cron and emails run with no site code in between):
   - **Email templates and prose** (`src/emails`, about 8.8 KB; 4.2 KB of prose): keep them in plugin storage or settings
     with an admin-editable copy, seeded from where? The seed must not just move the bytes back into the bundle. Options
     to weigh: the site-side Astro kit seeds or pushes templates through a private route on first admin visit; a tiny
     built-in fallback; templates fetched from the pinned host (only if the contract already allows it, no new host).
   - **Admin Block Kit pages and messages** (`src/admin`, about 25.6 KB): could page definitions be data (JSON in storage
     pushed by the Astro kit or an admin action) rendered by a small interpreter? Measure interpreter versus saving.
   - **Anything else** large and data-like (setup check page, CSV headers, ICS text, help copy).
   Implement only candidates that save real bytes without making a fresh install worse (a site that never ran the
   seed must still work: booking, emails, admin). Write up the rest with numbers.
3. **A size line in the PR template or a check** that reports `plugin.mjs` bytes and the change against main on every
   PR, so size stays visible without a freeze (if there is a cheap way in CI; otherwise note how to see it).

## Constraints

- No change to the trust contract (`packages/events/trust-contract.json`): no new hosts, capabilities, public routes or
  hooks. A new private route is fine if it doesn't change the contract (check how the contract counts routes).
- Behaviour unchanged for existing sites; existing tests pass unchanged except where they assert exact source text.
- Pro bundles Free: run Pro's verify (`/Users/semics/code/semics/emdash-plugins-pro`, `corepack pnpm@10.23.0 verify`,
  with its `node_modules/@semics-tech/*` links pointed at your worktree, then put them back) and report Pro's
  `plugin.mjs` size before and after.
- Goal: at least 4 KiB back under the 125 KiB budget (so at or below 121 KiB = 123,904 bytes less 4 KiB margin ...
  concretely `EVENTS_HOTFIX_ROOM` ≥ 4 KiB again), more if the out-of-bundle work pays.

## Acceptance criteria

- [x] `plugin.mjs` smaller, with a table of each change and its bytes.
- [x] Each out-of-bundle candidate measured; the ones that pay implemented with a working fresh-install fallback.
- [x] Size visible per PR, or documented how to see it.
- [x] `pnpm verify` and e2e pass; Pro verify passes; changesets (patch).

## Notes

### Plan (measured before implementing)

Method: T161's. The plugin CLI's own runtime build (`@emdash-cms/plugin-cli@0.13.3` `dist/api.mjs` `buildRuntime`:
tsdown 0.20.3, ESM, `platform: "neutral"`, `minify`, `treeshake`, the same `noExternal`) plus `sourcemap: true`;
each byte of the minified file is given to the source its sourcemap segment points at (`source-map-js`); literals
come from parsing the output (`@babel/parser`). A probe is the same build with one source edit, then restored.
Scratch scripts only, not committed. Baseline: `dist/plugin.mjs` **123,871 B** (main, rc.10).

Checked first: the bundler (rolldown 1.0.0-rc.3 via tsdown) does **not** inline a shared string constant back
into its uses (probe: 5 files' `"confirmed"` behind one `const` saved 207 B), so shared constants pay.

| # | Change | Estimate |
|---|---|---:|
| 1 | `src/domain/names.ts`: booking/event/occurrence/attendee statuses and error codes as one constant each (6.6 KB of the bundle was second copies of a literal; the top 28 names) | ~1.7 KB |
| 2 | `isStr` / `isNum` guards for the 50+ `typeof x === "string"` / `"number"` checks | ~0.5 KB |
| 3 | Admin: one `note(severity, title, message?)` builder for the 24 notice literals, severity constants | ~0.4 KB |
| 4 | More repeated names (`"POST"`, `"occurrences"`, `"error"`/`"warning"`/`"info"`, zod-style issue codes) | ~0.3 KB |
| 5 | Whatever the sourcemap shows next in `admin/panel.ts`, `admin/pages.ts`, `domain/config.ts` | 0.5 to 1 KB |

Out-of-bundle candidates (probes on top of change 1, 122,136 B):

| Candidate | Bytes it would free | Sandbox fit | Fresh install | Verdict |
|---|---:|---|---|---|
| Email templates and prose (`emails/confirmation.ts`) | 2,957 at most (the whole module; 1,119 B of it literals, 519 B prose) | Storage or settings read in the cron drain: the drain is already at R22's 10-call limit (two confirmations with occurrences), so a template read cuts a tick to one message | Needs the same templates as a fallback, so the bundle keeps them; a "tiny" fallback would send worse emails | **No** |
| Admin Block Kit pages as data (`src/admin`, 25.6 KB) | Literals are ~7.3 KB of it; the rest is logic (reads, tables, forms built from storage) an interpreter would still need | Private route + storage read per page load | Needs the pages as a fallback, so nothing leaves | **No** |
| Setup check page (`setupPage` + `validateMapping` + `encryptionKeyStatus`) | **3,243** (probe: page 898, `domain/mapping.ts` 1,539, `domain/encryption.ts` 690, others 116) | Could move to the Astro kit (a `/_events/setup` page) or the docs CLI | The admin "Events setup" page would lose its mapping and encryption-key checks: an admin change, so not "behaviour unchanged" | **Not now**; written up for Oli |
| ICS text (`routes/ics.ts` 2,708 + `shared/ics.ts` 2,644) | — | Public route the confirmation email links to | Must stay | **No** |

The third email option, templates fetched from the pinned host, is out: the contract's one host is
`challenges.cloudflare.com` (Turnstile), which serves no templates, and a new host is a contract change.

### Done

**Bytes** (`dist/plugin.mjs` from `pnpm run build`; the sourcemap build is the same plus a trailing newline):

| # | Change (commit) | `plugin.mjs` after | Saved |
|---|---|---:|---:|
| | main, rc.10 | 123,871 | |
| 1 | Statuses and error codes as constants in `src/domain/names.ts` (28 names; `STATUSES` built from them) | 122,135 | 1,736 |
| 2 | `isStr` / `isNum` for the 47 `typeof ... "string"/"number"` checks | 121,529 | 606 |
| 3 | `publicPost(handler)` for the 8 public POST routes (`routes/reply.ts`) | 121,336 | 193 |
| 4 | `note()` / `say()` for the admin notices (`admin/ui.ts`) | 121,035 | 301 |
| 5 | More names: notice severities, `occurrences`, `release`, `invalid_type`, `waiting`, and the codes in ternaries step 1 missed | 120,708 | 327 |
| 6 | `msOf` for every `Date.parse` (same result for `undefined`/`null`: NaN), aliases `isFin`, `keysOf`, `maxOf`, `toJson` | 119,864 | 844 |
| 7 | Aliases `isArr`, `isInt`, `uriEnc` and a bound `allOf` (`Promise.all` needs `this`) | **119,444** | 420 |
| | **Total** | | **4,427** |

Room now: 4,460 B beyond the 4 KiB hotfix room under the 125 KiB budget (was 33 B), 11,628 B under the
registry's 128 KiB cap. The size test is unchanged: its limits are constants and it passes with more room.
Aliases are named so they do not shadow locals (`maxOf`, not `max`; `allOf`, not `all`: `admin/schedule.ts` has
an `all`). `CONTEXT.md` asks new code to use them.

**Out of the bundle:** nothing moved, so a fresh install behaves exactly as before (no seed, no new route, no
storage read). Each candidate is in the plan's table above; none frees bytes without the bundle keeping a
fallback of the same size, except the setup check page (3,243 B), which would take a diagnostic away from the
admin page. That is a product decision for Oli: move the mapping and encryption-key checks to a site-side
`/_events/setup` page (or the CLI) and keep a one-line admin page linking to it.

**Measured but not done:**

- Factory for the shared Block Kit builders (`header`, `context`, `fieldsBlock`, `stats`, `actions` share one
  shape): about 150 B, but it changes `@semics-tech/shared`, which E-sign bundles too. Next time size is short.
- `.length > 0` to truthiness in conditions (56 uses, ~100 B): needs a by-hand check of each, value contexts
  differ (`0` vs `false`).
- Found on the way: `retentionErase` (`admin/pages.ts`) gives two notices a `description`, which `NoticeInput`
  does not have, so "Live bookings of upcoming events are kept." and "Run the deletion again to finish." never
  show (81 B of dead text). Left as is: showing them is a behaviour change, dropping them hides the intent.
  Worth a small fix task (`description` to `message`).

**Size per PR:** `scripts/bundle-size.mjs` (tested in `scripts/bundle-size.test.mjs`, its limits checked against
`packages/shared/testing/bundle-size.ts`) prints each built `plugin.mjs` with its room; the CI `verify` job
appends it to the job summary on every run (`if: always()`). A PR's number compares with the same table in
main's latest CI run (CI also runs on pushes to main). Locally: `node scripts/bundle-size.mjs` after a build.

**Pro** (bundles Free): Events Pro `dist/plugin.mjs` **249,833 → 245,267 B** (−4,566), built with every
`node_modules/@semics-tech/*` link in the Pro checkout pointed at this worktree. Pointing only `events-pro`'s links
there bundles `shared` twice (once through `pro-kit`) and hides the saving (249,043 B): point all of them. Links
restored afterwards with `pnpm install` and Pro rebuilt (249,833 B again). Nothing changed in the Pro repo.

**Tests:** `pnpm verify` passed (Events: 85 files, 896 tests; every gate). `pnpm --filter playground e2e`:
143 passed, 12 skipped. Pro `pnpm verify` passed against this worktree.
