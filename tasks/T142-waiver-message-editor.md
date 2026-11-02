---
id: T142
title: "Event editor says waivers need Events Pro when Pro is installed but not paired"
phase: 7
package: events
edition: free
status: review
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

- [x] A test fails today: with the Pro waivers seam reporting `pairing`, the Event editor shows the
      pairing message, the same as the panel.
- [x] The Free edition (no seam) still shows the edition message on both.
- [x] When paired and licensed, the editor offers the waiver template fields like the panel.

## Notes

- Free (MIT seam): `adminRoute({ waivers })` takes the same `(ctx) => WaiverCheck` factory as
  `editorTicketsRoute({ waivers })` and puts it on `AdminDeps.waivers`, which `panelPage` hands to `handlePanel`.
  Without it (Free) the page still shows the edition message. Test: `tests/routes/admin-waivers.test.ts` runs both
  routes' handlers with the same seam (pairing, available, none).
- Pro (`emdash-plugins-pro`, worktree `/Users/semics/code/semics/.pro-worktrees/agent-a55aba050faff8ceb`, branch
  `pro-agent-a55aba050faff8ceb`): `src/plugin.ts` defines one `proWaivers` and passes it to both `editorTicketsRoute`
  and `adminRoute`; `tests/waivers.editions.test.ts` drives Events -> Edit through the `admin` route (pairing missing:
  the pairing banner; paired + licensed: the waiver fields; Free: the edition message). Commits `7b196c0` (test) and
  `3fc1e57` (feat, with a changeset). Land the public branch first: the Pro worktree's `node_modules` links
  `@semics-tech/emdash-events` and `@semics-tech/shared` (events-pro) were pointed at this public worktree to run
  the Pro tests; run `pnpm install` in the Pro repo after landing.
- Out of scope, noticed: the Pro questions form on the entry panel is not on the Event editor page (Pro only wraps
  `editor/tickets`), and it uses a `repeater` (see T141 Notes).
