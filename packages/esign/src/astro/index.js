// Astro entry for the e-sign UI. Auto-wired through componentsEntry. The pages themselves are
// injected by `esignIntegration()`; the one portable-text block is `esign-request` (a self-serve template, E-sign Pro).
import SelfServeBlock from "./SelfServeBlock.astro";

export const blockComponents = { "esign-request": SelfServeBlock };

// The only way UI code calls the core (in-process public routes, fetch fallback).
export { callPublicRoute, ESIGN_PLUGIN_ID } from "./lib/call.ts";
// A page that renders <SigningCeremony> sends `ceremonyCsp()` as its Content-Security-Policy.
export { ceremonyCsp, verifyCsp } from "./lib/csp.ts";
export { parseSnapshot, safeHref } from "./lib/markdown.ts";
// After a sign or decline, `ceremonyRedirect(view)` is the 303 target carrying the receipt (T062).
export {
	ceremonyRedirect,
	handleSign,
	handleSignedCopy,
	handleVerify,
	normaliseStrokes,
	receiptReturnUrl,
} from "./lib/sign.ts";
export { SelfServeBlock };
