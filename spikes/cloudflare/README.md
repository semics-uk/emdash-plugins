# Cloudflare platform-limit probes (T110)

A host Worker (`src/host.js`) that runs probe code in a Worker Loader isolate exactly the way
`@emdash-cms/cloudflare` 1.2.0 runs a sandboxed plugin: a fresh loopback bridge binding per request
(`ctx.exports.ProbeBridge({ props })`, same shape and SQL as `PluginBridge`), `globalOutbound: null`
and `limits: { cpuMs: 50, subRequests: 10 }`. Findings are in BUILD-PLAN §7 ("Measured on Cloudflare");
raw numbers are in `results/`.

Not part of the pnpm workspace. Every resource is named `semics-probe-*` and is deleted after a run.

```sh
cd spikes/cloudflare
npm install                       # pdf-lib, for the S5 comparison only
W=../../node_modules/.pnpm/wrangler@4.149.0_*/node_modules/wrangler/bin/wrangler.js
node $W d1 create semics-probe-d1  # note the id
PROBE_D1_ID=<id> node build.mjs    # writes gen/ (gitignored)
node $W deploy -c gen/wrangler.jsonc
node $W secret put PROBE_KEY -c gen/wrangler.jsonc   # any random string
PROBE_URL=https://semics-probe-limits.<subdomain>.workers.dev PROBE_KEY=<key> \
  PROBE_ONLY=s1,s4,unique,s5,s5t,sustain,cpu node --test probe.test.mjs
# wait 15+ minutes, then PROBE_ONLY=cron for the tick log
node bench-local.mjs > results/s5-local.json     # Node CPU calibration
node $W delete semics-probe-limits --force && node $W d1 delete semics-probe-d1 -y
```

| Test (`PROBE_ONLY`) | Measures |
|---|---|
| `s1` | Bridge RPCs (no-op, D1-backed storage get, kv get, parallel), outbound fetch and `getMany` against `subRequests: 10`, and with no limits |
| `s4` | Largest `storagePut` document on real D1, bisected |
| `unique` | EmDash's `uidx_` expression index on real D1: duplicate insert, NULL/missing field, batch atomicity |
| `s5`, `s5t`, `sustain`, `cpu` | pdf-mini (stand-in for T016) vs pdf-lib create/stamp for 1, 3, 5 pages: max renders under 50 ms, I/O-bracketed timings, sustained pass rates, and where `cpuMs` actually stops an invocation |
| `cron` | Tick times of the `* * * * *` trigger EmDash recommends, and S1 inside `scheduled()` |
