# EmDash 1.2: `plugin:install` / `plugin:activate` never run for config-declared sandboxed plugins

Draft for the owner to file upstream (found in T056, worked around in T116).

## Summary

A sandboxed plugin listed under `sandboxed: [...]` in the EmDash Astro integration config is loaded,
enabled and serves routes and hooks, but its `plugin:install` and `plugin:activate` hooks never run.
Native plugins in `plugins: [...]` get install → activate once, at first boot. Anything a sandboxed
plugin sets up in activation (typically `ctx.cron.schedule(...)` for recurring tasks) therefore never
happens on an npm/config install, silently.

## Versions

- `emdash` 1.2.0, `@emdash-cms/plugin-test` 0.2.8, Node adapter with the workerd sandbox runner
  (`@emdash-cms/cloudflare` sandbox runner behaves the same: the gap is in the runtime, not the runner).

## Reproduction

1. A sandboxed plugin whose `plugin:activate` schedules a recurring task:

   ```ts
   const plugin: SandboxedPlugin = {
     hooks: {
       "plugin:activate": async (_event, ctx) => {
         await ctx.cron?.schedule("tick", { schedule: "* * * * *" });
       },
       cron: async (event, ctx) => ctx.log.info("tick", { name: event.name }),
     },
   };
   ```

2. Declare it in `astro.config.mjs`: `emdash({ sandboxed: [myPlugin], ... })`, build, start the site
   on a fresh database, and load any page.
3. `SELECT * FROM _emdash_cron_tasks WHERE plugin_id = 'my-plugin'` returns no rows, and the `cron`
   hook never runs. `_plugin_state` has no row for the plugin either.
4. The same happens in `createPluginRuntimeTestHost()`: `inspect.scheduledTasks()` stays empty until
   the test calls `actions.plugin.activate()`.

## Expected

On the first boot that sees a config-declared sandboxed plugin with no `_plugin_state` row, run
`plugin:install` then `plugin:activate` once, exactly as for native config plugins (and as an admin
install or re-enable does for marketplace/registry plugins).

## Actual

`EmDashRuntime.create` ends with
`runtime.installUnrecordedConfigPlugins(deps.plugins, pluginStates)`, which iterates `deps.plugins`
(native config plugins) only. `deps.sandboxedPluginEntries` are loaded into the hook pipeline and
marked enabled (`status === undefined` counts as active), but never passed to the install/activate
lifecycle, so no `_plugin_state` row is created and neither hook runs. Disabling and re-enabling the
plugin in the admin does run `plugin:activate` (`setPluginStatus` → `runPluginActivate`), which is the
only way to trigger it today.

## Suggested fix

Pass the configured sandboxed entries to the same once-only lifecycle, e.g.
`installUnrecordedConfigPlugins([...deps.plugins, ...deps.sandboxedPluginEntries], pluginStates)`
(the sandboxed proxies are already in the pipeline, so `runPluginInstall`/`runPluginActivate` reach
them), keeping the `createActiveIfAbsent` guard so only one isolate runs the hooks.

Alternatively (or additionally), a declarative manifest field for recurring tasks
(`"cron": [{ "name": "tick", "schedule": "* * * * *" }]`) that the host upserts on load would remove
the need for activation-time scheduling altogether.

## Our workaround (T116)

Both cores keep scheduling in `plugin:activate`, and certain always-hit routes (public event reads, admin page
loads, template creation, the verify page) also make one KV read of a `cron:scheduled:v1` flag. When
the flag is missing they queue a one-shot `ensure-schedules` cron task (one more call); its cron
invocation schedules the recurring tasks and sets the flag. Cost: +1 bridge call per guarded request,
+2 until the first tick. We can drop it once the fix ships.
