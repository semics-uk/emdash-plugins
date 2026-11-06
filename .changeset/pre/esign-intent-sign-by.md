---
"@semics-tech/emdash-esign": patch
"@semics-tech/shared": patch
"@semics-tech/emdash-events-suite": patch
---

An integration's signing intent can carry `signBy`. E-sign then stops taking a signature at that time plus the protocol's clock skew, closes the envelope and issues its `expired` receipt, with no call back to the integration. A later intent for the same signature can extend the deadline but never shorten it. The waiver page re-issues the seats still to sign when a signature extends the booking's hold.
