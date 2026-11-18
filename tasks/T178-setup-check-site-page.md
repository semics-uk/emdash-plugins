---
id: T178
title: "Move the Events setup check off the Free backend to a site page, /_events/setup"
phase: 8
package: events
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T162]
spec: []
---

# T178 Setup check on the site page `/_events/setup`

Oli, 2026-11-18: "move the T162 setup check page out". T162 measured the admin setup check (`setupPage` +
`validateMapping` + `encryptionKeyStatus`) at 3,243 B of the Free backend, which had 153 B left under its budget.

## Done

- `/_events/setup` (`src/astro/SetupPage.astro`, logic in `src/astro/lib/setup.ts`), injected by `eventsIntegration`, so
  it works on Free-only sites (no suite needed). Follows `/_events/pair`: core's own handlers run in process with the
  visitor's `locals`:
  - plugin-settings GET (`emdash/internal/routes/api/admin/plugins/_id_/settings`) is the administrator check
    (`plugins:manage`); 401/403 → "Sign in to the admin as an administrator" and HTTP 403, nothing else is read;
  - schema GET (`emdash/internal/routes/api/schema/index`, `schema:read`) gives the collections and their fields.
- **Secrets.** Core's settings GET masks secrets: they are left out of `values` and reported only as
  `secretsSet[key]` (true when stored and not empty). That tells set from unset, not readable from unreadable. So for
  each secret the host says is set, the page calls `getPluginSetting(pluginId, key)` on the server: core decrypts it
  and throws `PluginSettingEncryptionError` when the key is missing, unknown or wrong. Text → readable; throw or
  anything else → unreadable; not set → unset. The value is dropped at once; the view holds only notices and the
  mapping fields (a test checks no secret text reaches the view). All secrets the host declares are checked (Pro's
  too), not only Free's two.
- Same notices and wording as the admin page had: mapping banner, "Saved secrets cannot be read", "Turnstile is not
  set up", the five mapping fields with "(not set)", and "Open plugin settings"
  (`/_emdash/admin/plugins-manager/<id>/settings`).
- `validateMapping` and `encryptionKeyStatus` moved to `src/astro/lib/mapping.ts` and `encryption.ts` (only `src/astro`
  ships in the package; `names.ts` imports replaced by `"error"` and `Object.keys`). Nothing in the backend imported
  them besides `setupPage`. Their tests stay (`tests/domain/*`, `tests/settings.test.ts`), with the new paths.
- The admin **Events setup** page is a header, one line, "Open the setup check" (external link to
  `<origin>/_events/setup`) and "Open plugin settings". It reads nothing. `AdminDeps.schema` is gone, and the admin
  route no longer passes `ctx.schema`.

## Bytes

`packages/events/dist/plugin.mjs` (`pnpm run build`):

| | bytes | room under 125 KiB less 4 KiB hotfix room (123,904) |
|---|---:|---:|
| before (main, rc.28) | 123,751 | 153 |
| after | 120,887 | 3,017 |

Saved 2,864 B (T162's probe said 3,243 with the whole page gone; the admin page's header and links stay).

## Tests

- `tests/ui/setup.test.ts`: forbidden (401/403, nothing else read), host errors, sound mapping, missing field,
  missing collection, defaults, unreadable secret (thrown or non-text), only set secrets decrypted, no secret in the
  view, Turnstile warning, notice order.
- `tests/ui/setup-page.build.test.ts`: no backend file imports the check; the page's headers and host handlers.
- `tests/ui/integration.test.ts`: the route is injected. `tests/admin/pages.test.ts`: the admin page links and reads nothing.
- e2e `apps/playground/e2e/t178-setup-check.spec.ts`: 403 signed out, the fields and settings link for the admin.

## Follow-ups

- Nothing in the backend calls `ctx.schema` now, so `schema:read` could leave the trust contract. Left declared: a
  capability change is a contract change for Oli to decide.
- The page could also say "Encryption key missing" when no key is configured (`resolvePluginEncryptionKeys`); left out,
  same outcomes as before.
- The page is English only, like `/_events/pair` (administrators only).
