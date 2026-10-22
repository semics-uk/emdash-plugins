/**
 * Browser helpers for the `/verify` page (SU-FR-02, ES-US-6). The implementation is plain
 * JavaScript (`verify.js`) because the page inlines its exact text under a hashed CSP.
 */
export { enhanceVerify, sha256Hex } from "./verify.js";
