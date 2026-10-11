
## Notes

- Findings are in BUILD-PLAN section 7 "Resolved locally"; evidence and the commit that ran the probes (66392ce) are in packages/events/tests/probes/README.md. Probe code is deleted.
- S8 is negative (fallback adopted in the spike table). S4 numbers are local D1 only; T110 must re-measure. S7 was source-derived plus a hash probe (hosts load one plugin).
- Follow-up: registry installs make ctx.plugin.id an r_ hash, not the slug; do not hard-code semics-events (UI call path, suite wiring, e-sign pairing).
- No src/ or manifest changes, so no changeset.
