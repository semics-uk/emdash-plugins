---
"@semics-tech/emdash-events-suite": patch
---

One-click pairing of Events Pro with Vouchers Pro on the same site (T172). With `eventsSuite({ vouchers })`,
`/_events/pair` has a Gift vouchers section: an administrator presses **Pair with Vouchers on this site** and the page
asks Vouchers' private `pairing/create` in process and stores the string in Events' `vouchersPairing` through the
host's settings handler. Nothing to copy, and the string never reaches the browser. The section shows paired, not
paired, or stale (Events holds a client that is not Vouchers' active one), and says why a pasted string cannot be
used (a space or line break around it, an E-sign string, or not a whole string) without showing it. Pressing it
while paired changes nothing. `/_vouchers/setup` links to it.
