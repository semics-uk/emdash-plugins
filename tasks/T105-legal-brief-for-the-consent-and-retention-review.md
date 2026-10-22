---
id: T105
title: "Legal brief for the consent and retention review"
phase: 7
package: docs
edition: free
status: review
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

- [x] Brief covers every item in the legal evidence table

## Implementation (green, then refactor)

- `docs/legal/brief.md`

## Acceptance criteria

- [x] Ready to send
- [x] Brief covers (T034 review): the default consent wording changed to "I agree to use electronic records and an electronic signature for this document." (the old one claimed the effect of a handwritten signature, which eIDAS Art. 25(2) reserves for qualified signatures); what the signed PDF keeps after the personal-data purge (name, IP, entered values); and whether `signer.viewed` should be recorded on a GET that mail scanners prefetch (T117)
- [x] Legal brief covers R45: personal data cleared after 12 months by default, while the signed PDF, snapshot and certificate (with name and IP) are kept for the signed-records period (default 7 years)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
n/a (document)
```

## Notes

- `docs/legal/brief.md` written from the code, not the docs. Differences it records (section 12): the certificate also
  prints the participant (minor's) name; entered values stay in the signed PDF until the signed-records period ends
  (README says the purge deletes them, true only of the signer record); OTP is not built (routes are stubs, T091 not done).
- T034 items covered: new consent wording and why (section 4), PDF contents after the purge (sections 5.3, 9), viewed-on-GET
  (steps 4, section 12; code records the view only on first POST).
- The Events waiver prefill content is decided by the Pro waiver step, which is not in this repo, so the brief says so
  rather than listing keys. Limitation-period remarks in the questions are prompts for the lawyer, not claims.
- The "legal evidence table" named in the test line was not found in the repo; sections 5.1 and 5.3 list every captured item.
- No code changed; manifest unchanged; docs only, so no changeset.
