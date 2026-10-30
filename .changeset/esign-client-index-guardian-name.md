---
"@semics-tech/emdash-esign": patch
---

Fixes two bugs found by the Pro playground e2e (T135). An integration client could create only one envelope on a real site: the `clients` collection declared `clientId` unique, and EmDash 1.2 builds a unique index over every collection of the plugin, so the second envelope from the same client (which also carries `clientId`) failed with a UNIQUE constraint error. The index is gone (EmDash drops it on upgrade; a client's document id is its client id, which keeps it unique), and the client is read by id. A guardian's signing page also showed "Signing as guardian for [object Object]": it now names the child.
