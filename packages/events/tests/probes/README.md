# T005 platform probes: evidence

The probe tests and their fixture plugin were deleted after the findings were recorded in
`BUILD-PLAN.md` section 7. They ran against `@emdash-cms/plugin-test` 0.2.8 and emdash 1.2.0 (Worker
Loader sandbox, local D1) at commit **2b5249d** (9 of 9 probe tests passing). To re-run them:
`git checkout 2b5249d -- packages/events/tests/probes` then
`vitest run --config tests/probes/vitest.config.ts` from `packages/events` (the config builds the
fixture plugin in `tests/probes/fixture`, not the real plugin).

Earlier commits of the same files: `5ccf964` (first expectations), `b4cb8ae` (run with
`capabilities: []`, which showed the `beforeDelete` hook is skipped without `content:read`).

| Spike | Finding |
|---|---|
| S3 one-shot cron | `ctx.cron.schedule(name, { schedule: "<ISO 8601 datetime>" })` fires once, then the row is deleted. No capability needed. Same name replaces the pending task. At most 10 due tasks per tick. Invalid name or schedule throws at schedule time. 6-field (seconds) cron accepted. |
| S4 document size | 64 KiB to 4 MiB round-trip; 8 MiB fails with `SQLITE_TOOBIG` (largest ok 8,323,072 bytes). The limit is on the serialised JSON. Local D1 only; keep documents at 512 KiB or less until T110. |
| S7 slug collisions | Registry installs use `r_` + base32(SHA-256(`did\nslug`)), so the same slug from two publishers does not collide. `ctx.plugin.id` is that hash for registry installs. Source-derived plus a hash-derivation probe. |
| S8 dynamic secrets | A non-schema key set with `ctx.settings.set` is stored as plaintext. A schema `secret` field is encrypted (needs `EMDASH_ENCRYPTION_KEY`). |
| S9 delete veto | Returning exactly `false` from `content:beforeDelete` blocks the trash action (`DELETE_BLOCKED`). `{ cancel: true, reason }` does not block. Needs `content:read`; skipped silently without it. Permanent delete of a trashed entry does not call the hook. |
