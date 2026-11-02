---
"@semics-tech/emdash-events": patch
---

`adminRoute({ waivers })` (T142): the Event editor page takes the same waiver check as the entry panel's `editorTicketsRoute({ waivers })`, so an edition that passes both shows the same waiver state on each (the page said "Required waivers need Events Pro" on a Pro site that only lacked the E-sign pairing string).
