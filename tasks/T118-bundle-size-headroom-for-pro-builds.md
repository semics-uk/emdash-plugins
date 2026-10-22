---
id: T118
title: "Bundle size headroom for Pro builds"
phase: 4
package: repo
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T063]
spec: [R42]
---

# T118 · Bundle size headroom for Pro builds

## Definition

The Pro Events backend is 127.0 KiB against a 128 KiB per-file bundle limit (T063), so the next Pro
features (T064, T073+) will not fit. Find out exactly where the limit comes from and whether it applies to
Pro builds installed from private npm under `sandboxed: [...]` (runtime/Worker Loader limit) or only to
registry bundles (`emdash-plugin validate`/`bundle`). Then create lasting headroom (R42), in this order of
preference: (1) shrink the Free core without behaviour change (measure what dominates: `zod/mini`,
duplicated shared helpers, Block Kit builders, string tables; tree-shaking and minification settings);
(2) if the limit is per file, split the bundle into several modules if the loader supports it; (3) only if
the limit is registry-only, record that Pro may exceed it and add a Pro-specific ceiling that still fails
the build well before any runtime limit.

## Model

**Opus 5.5**: Build-tool and platform investigation with a measurable outcome.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] A build-size test per bundle (Free events, Free esign, Pro events, Pro esign) asserts a budget that leaves ≥ 24 KiB headroom under the applicable limit
- [x] The behaviour suites stay green (no functional change)

## Implementation (green, then refactor)

- Build config in `packages/events`, `packages/esign`, `packages/shared`; Pro repo build scripts if needed

## Acceptance criteria

- [x] Source of the 128 KiB limit cited (file and line in the EmDash sources) and recorded in BUILD-PLAN §7
- [x] Size table before/after per bundle in the task Notes
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 verify
```

## Notes

**Where the limit comes from (recorded in BUILD-PLAN §7).** The 128 KiB per-file cap belongs to the registry
bundle format (RFC 0001: 128 KiB per file, 256 KiB in total, 20 files):
- `@emdash-cms/plugin-cli@0.13.3` `dist/index.mjs:869` (`src/bundle/utils.ts`) `MAX_FILE_SIZE = 128 * 1024`,
  enforced in `validateBundleSize` (`:1070`), which `bundlePlugin` runs (`:3248`) for both
  `emdash-plugin validate` and `bundle`.
- `@emdash-cms/registry-verification@0.3.4` `dist/bundle.js:11` and `:145` `MAX_BUNDLE_FILE_BYTES`, which
  `emdash@1.2.0` `src/registry/artifact-verification.ts:42` uses on registry installs and updates.
- Installs declared in the config (`sandboxed: [...]`, from npm or a path) are **not** size-checked:
  `src/astro/integration/virtual-modules.ts:660` reads the file and embeds it, and neither sandbox runner checks
  code size. The Worker Loader takes one module per plugin, so splitting the backend into several files does not
  work. Pro still runs `validate` and should stay publishable to the registry, so the cap applies to all four
  bundles.

**What took the space.** In Free Events, `zod/mini` was 21.0 KiB of the 119.8 KiB minified. Unused PDF font
tables from `@semics-tech/shared` added 3.1 KiB; they stayed in only because the package was not marked
side-effect free. Most of the rest was small helpers copied into each file. `emdash-plugin build` already
minifies and tree-shakes (rolldown, with options we can't change), so its settings have nothing more to give.

**Changes (no behaviour change).**
- Events checkout bodies now go through a small validator in `src/domain/checkout.ts`. It returns the same
  values and issues (path, code and order) as the old zod/mini schemas, quirks included: length checks still run
  after a type error. `tests/domain/checkout-input.test.ts` compares the two over a generated set of inputs. zod
  stays a devDependency for that test only.
- `@semics-tech/shared` is marked `sideEffects: false`.
- Helpers that were copied per file now exist once:
  - Events: route reply helpers, admin `respond`/`str`/status options/notices, `iso`, the held-booking guard,
    and the email sentences.
  - Shared: `encodeBase64Url`, `toHex`, `webCryptoRandom` and `hmacSha256Key` (new `shared/src/bytes.ts`), plus
    `column()` in the Block Kit builders.
  - E-sign: the signer name and field-value validators.

**Sizes** (`backend.js` bytes; "before" is main after T117; Pro was measured against these sources):

| Bundle | Before | After | Room under the 104 KiB budget |
|---|---|---|---|
| Free Events | 122,627 (119.8 KiB) | 97,378 (95.1 KiB) | 9,118 B |
| Free E-sign | 103,360 (100.9 KiB) | 101,698 (99.3 KiB) | 4,798 B |
| Pro Events | 130,094 (127.0 KiB) | 105,259 (102.8 KiB) | 1,237 B |
| Pro E-sign | 107,416 (104.9 KiB) | 106,089 (103.6 KiB) | 407 B |

**Tests.**
- Size checks (all assert ≤ 104 KiB):
  - `tests/bundle-size.build.test.ts` in both cores, using `@semics-tech/shared/testing/bundle-size`.
  - An R42 test in the Pro build suite that checks both the Pro and the Free backend.
- Red: Free Events (119.8 KiB) and Pro Events (127.0 KiB) failed. Free and Pro E-sign were under the budget
  when the tests were written. After T117 landed, Pro E-sign was 104.9 KiB, over the budget, until the second
  feat commit.

**For the orchestrator.**
- The budget is 104 KiB for every bundle, as this task asks. That keeps 24 KiB free under the cap, but it leaves
  no room for new Pro code: T064 and T073 will hit the Pro budget straight away (Pro E-sign has 0.4 KiB left,
  Pro Events 1.2 KiB). Each Pro feature must do one of two things, and you need to choose which:
  - shrink Free further, or
  - record a smaller headroom in R42 and raise `BUNDLE_BUDGET` in `pro-kit/testing/build-suite.ts`.
- The Pro size test fails in the Pro worktree until this public branch lands, because Pro links the public main
  checkout. I checked Pro against this branch in a scratch copy whose `emdash-plugins` link points at this
  worktree.
