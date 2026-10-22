// Astro entry for the e-sign UI. Auto-wired through componentsEntry. The pages themselves are
// injected by `esignIntegration()`; this plugin registers no portable-text blocks.
export const blockComponents = {};

// The only way UI code calls the core (in-process public routes, fetch fallback).
export { callPublicRoute, ESIGN_PLUGIN_ID } from "./lib/call.ts";
// A page that renders <SigningCeremony> sends `ceremonyCsp()` as its Content-Security-Policy.
export { ceremonyCsp, verifyCsp } from "./lib/csp.ts";
export { parseSnapshot, safeHref } from "./lib/markdown.ts";
export { handleSign, handleSignedCopy, handleVerify, normaliseStrokes } from "./lib/sign.ts";
