---
id: T127
title: "E-sign Pro: near-limit uploaded PDF inside the CPU budget on CI"
phase: 6
package: esign
edition: pro
status: done
model: opus-5.5
size: S
depends_on: [T125]
spec: [R53, R92]
---

# T127 · E-sign Pro: near-limit uploaded PDF inside the CPU budget on CI

## Definition

The first real Pro build on GitHub (pro-release.yml dry run, run 40325534223 in semics-uk/emdash-plugins-pro)
fails one test of 192: `packages/esign-pro/tests/pdf-templates.editions.test.ts` "S5 R53 a near-limit PDF
renders in one invocation within the bridge-call and CPU budgets", `hook "cron" used CPU 57.0 ms (limit 50
ms)`. This is the open R53 check from T111. Measure where the time goes on a GitHub runner (as T125 did,
with a throwaway workflow in the Pro repo), then make the cron fit 50 ms on CI for the largest uploaded PDF
it accepts, by cheaper code or, failing that, a measured, recorded lower upload limit (R row) refused with a
clear error at upload. Pro CI only runs in pro-release.yml (dry run by default, so safe to dispatch).

## Acceptance criteria

- [x] Cause recorded with CI numbers in this file
- [x] Test first, then the fix; budgets stay strict on CI
- [x] A pro-release.yml dry run (dry-run=true) is green end to end; run id recorded; T111's R53 criterion ticked if this proves it (it does not: see Notes)
- [x] Meets the Definition of Done

## Notes

- **Cause:** the PDF reader (`packages/esign-pro/src/pdf/read.ts`) turned the whole upload into a string with
  `TextDecoder("latin1")`, which is windows-1252 and slow on workerd. Measured per phase on a GitHub runner
  (throwaway Pro workflow, runs 40327037809 and 40327178803; the cron stopped after each phase, 7 samples each) for
  the 3,130,235-byte test PDF: bridge reads 0-1 ms, base64 join 1 ms, SHA-256 of the original 2 ms, **the
  windows-1252 decode 19-20 ms**, the rest of parsing, stamping and the second SHA-256 ~5 ms, chunking and
  `putMany` ~0. Whole cron 27-30 ms warm, 35-38 ms on its first call, 57 ms in the full suite (run 40325534223).
  Locally the decode was ~15 ms of 20-25 ms; in Node it is only ~2.6 ms, so a Node benchmark hides it.
- **Fix (Pro 5b4f61a test, 8258555 fix, 36bcec6 refactor):** widen the bytes to a `Uint16Array` and decode
  UTF-16LE (2-3 ms on CI), which also makes the byte string exact for 0x80-0x9F, so the windows-1252 mapping back to
  bytes is gone. No upload limit change: the near-limit cron now measures **12-15 ms CPU in the full suite on CI**
  (run 40327560896, three runs), under half the 50 ms budget. Budgets stay strict on CI. The upload route uses the
  same decoder, so it got cheaper too.
- Green dry run: pro-release.yml run **40328431783** (dry-run=true, public-ref=main, Pro commit 36bcec6): 192 Pro
  E-sign tests pass, both packages pack under `rc`.
- T111's R53 criterion is not ticked: it asks for a cold invocation on Cloudflare staging, which a GitHub runner does
  not prove (the CI numbers above are evidence the 3 MiB cap can stay).
- `biome ci .` in the Pro repo reports pre-existing `useOptionalChain` lint errors in files this task did not touch
  (pro-release.yml does not run Biome).
