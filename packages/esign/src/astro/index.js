// Astro entry for the e-sign UI. Auto-wired through componentsEntry. The pages themselves are
// injected by `esignIntegration()`; this plugin registers no portable-text blocks.
export const blockComponents = {};

// The only way UI code calls the core (in-process public routes, fetch fallback).
export { callPublicRoute, ESIGN_PLUGIN_ID } from "./lib/call.ts";
export { handleSign } from "./lib/sign.ts";
