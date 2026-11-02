---
"@semics-tech/emdash-events-suite": patch
---

`/_events/pair` recognises a pairing made by hand: it shows as paired (not revoked), and pressing Pair keeps that one client instead of leaving an unused second one. Only the client id of the stored pairing is read and passed to E-sign on the server; the secret is never sent anywhere.
