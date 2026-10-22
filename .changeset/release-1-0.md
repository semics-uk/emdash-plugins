---
"@semics-tech/emdash-events": major
"@semics-tech/emdash-esign": major
"@semics-tech/emdash-events-suite": major
---

1.0: the trust contract is frozen (T106). Each core's capabilities, allowed hosts, public routes, MCP tools and hooks are recorded in its `trust-contract.json` and checked by a test; adding any of them is now a major version that operators consent to again. Both manifests declare the EmDash range they support (`release.requires`: `env:emdash` `>=1.2.0 <2`), so EmDash and the registry refuse an install on a host outside it.
