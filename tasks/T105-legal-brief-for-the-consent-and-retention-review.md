---
id: T105
title: "Legal brief for the consent and retention review"
phase: 7
package: docs
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T097]
spec: [D4]
---

# T105 · Legal brief for the consent and retention review

## Definition

A brief for the lawyer: what the product claims, the evidence it captures, consent wording, retention defaults, open questions.

## Model

**Sonnet 5.5**: Structured writing.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Brief covers every item in the legal evidence table

## Implementation (green, then refactor)

- `docs/legal/brief.md`

## Acceptance criteria

- [ ] Ready to send
- [ ] Brief covers (T034 review): the default consent wording changed to "I agree to use electronic records and an electronic signature for this document." (the old one claimed the effect of a handwritten signature, which eIDAS Art. 25(2) reserves for qualified signatures); what the signed PDF keeps after the personal-data purge (name, IP, entered values); and whether `signer.viewed` should be recorded on a GET that mail scanners prefetch (T117)
- [ ] Legal brief covers R45: personal data cleared after 12 months by default, while the signed PDF, snapshot and certificate (with name and IP) are kept for the signed-records period (default 7 years)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
n/a (document)
```
