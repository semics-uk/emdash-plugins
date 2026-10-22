// Cloudflare Worker entry of the playground (T111): EmDash's handler, its plugin bridge for the
// Worker Loader sandbox, and the minute Cron Trigger that runs plugin cron. Only the Cloudflare build
// (wrangler.jsonc `main`) uses it; the Node build ignores it.
import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";

export { PluginBridge };

export default {
	...handler,
	scheduled: createScheduledHandler(),
};
