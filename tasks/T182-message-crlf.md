---
id: T182
title: "Vouchers: accept CR LF line breaks in the gift message and post address"
phase: 8
package: vouchers-pro
edition: pro
status: done
model: opus-5.5
size: S
depends_on: [T168]
spec: []
---

# T182 CR LF in the gift message

Reported by the lmsc-site session on 2026-11-24 (lmsc-site #148) and reproduced on staging. Released in rc.32 (Pro #23).

- **Cause.** Browsers send a textarea's line breaks as CR LF. `text()` in `domain/purchase.ts` refuses `\r` as a
  control character, so any message with a line break got `BAD_REQUEST`. The live customer on 21 Nov typed "Happy
  Birthday!⏎⏎Love from Mum & Dad xxx" and gave up. No live checkout had started since 20 Nov.
- **Fix.** The message and the post address go through `lines()`, which turns CR LF and a lone CR into LF before the
  same check. Other control characters are still refused. Free's `readBuyForm` does the same since T183.
- lmsc-site's Worker workaround (lmsc-site PR #159) can go once lmsc runs rc.32 or later.
