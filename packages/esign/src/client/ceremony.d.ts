// Types for ceremony.js, which is plain JavaScript so the page can inline its exact text (CSP hash).
export interface FieldState {
	name: string;
	required: boolean;
	value: string;
}

export interface SignState {
	typedName: string;
	consent: boolean;
	intent: boolean;
	fields: FieldState[];
}

export interface CeremonyOptions {
	fetch?: typeof fetch;
	intervalMs?: number;
	attempts?: number;
}

export function missingForSign(state: SignState): string[];
export function safeDownloadHref(value: unknown, origin: string): string | undefined;
export function pdfLinkFrom(reply: unknown, origin: string): string | undefined;
export function enhanceCeremony(root: Document, options?: CeremonyOptions): void;
