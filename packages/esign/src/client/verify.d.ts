// Types for verify.js, which is plain JavaScript so the page can inline its exact text (CSP hash).
export function sha256Hex(bytes: ArrayBuffer): Promise<string>;
export function enhanceVerify(root: Pick<Document, "querySelectorAll" | "getElementById">): void;
