---
id: T142
title: "Event editor says waivers need Events Pro when Pro is installed but not paired"
phase: 7
package: events
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: []
spec: []
---

# T142 · Event editor waiver message

## Definition

On LMSC staging (Events Pro and E-sign installed, not paired yet) the content entry panel correctly
says "Add the E-sign pairing string in the settings to require waivers", but Events → Event editor
says "Required waivers need Events Pro and the E-sign plugin." (`WAIVER_UNAVAILABLE.edition` in
`packages/events/src/admin/panel.ts`). The editor path builds its waiver availability without the Pro
`waivers` seam, so it falls back to `FREE_EDITION`. Make both paths ask the same seam.

## Acceptance criteria

- [ ] A test fails today: with the Pro waivers seam reporting `pairing`, the Event editor shows the
      pairing message, the same as the panel.
- [ ] The Free edition (no seam) still shows the edition message on both.
- [ ] When paired and licensed, the editor offers the waiver template fields like the panel.
