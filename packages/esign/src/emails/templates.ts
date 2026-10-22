/**
 * Invitation and completion emails (ES-FR-10): links only, never an attachment.
 *
 * Bodies are filled with `fill`, not the shared `renderTemplate`: that one escapes values for
 * Markdown (`-`, `_`, `.`-adjacent punctuation get a backslash), which would corrupt a signing
 * token (base64url: `-` and `_`) and mangle names like "Mary-Jane" in a plain-text email. Here a
 * value is used verbatim in text and HTML-escaped in HTML.
 */
import type { OutboxMessage } from "@semics-tech/shared";

export interface InvitationInput {
	readonly to: string;
	readonly signerName: string;
	readonly title: string;
	/** Who is asking: the `senderName` setting, else the site name. */
	readonly sender: string;
	/** Absolute `/sign/<token>` URL. */
	readonly link: string;
	readonly expiresAt: string | null;
}

export interface CompletionInput {
	readonly to: string;
	readonly signerName: string;
	readonly title: string;
	readonly sender: string;
	/** Absolute, short-lived download URL for the signed PDF. */
	readonly link: string;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);
/** One line, so a value can never add a header or a paragraph. */
const oneLine = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ");

const PLACEHOLDER = /\{\{(\w+)\}\}/g;
function fill(template: string, values: Record<string, string>, encode: (v: string) => string): string {
	return template.replace(PLACEHOLDER, (_all, key: string) => encode(values[key] ?? ""));
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
function longDate(iso: string): string {
	const d = new Date(iso);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const INVITATION_SUBJECT = "{{sender}} asks you to sign: {{title}}";
const INVITATION_TEXT = `Hello {{name}},

{{sender}} has asked you to review and sign "{{title}}" electronically.{{expiry}}

Open this link to read the document and sign:
{{link}}

This link is personal to you. Please do not forward it.
`;
const INVITATION_HTML = `<p>Hello {{name}},</p>
<p>{{sender}} has asked you to review and sign &quot;{{title}}&quot; electronically.{{expiry}}</p>
<p><a href="{{link}}">Review and sign the document</a></p>
<p>This link is personal to you. Please do not forward it.</p>`;

const COMPLETION_SUBJECT = "Signed: {{title}}";
const COMPLETION_TEXT = `Hello {{name}},

Thank you. "{{title}}" for {{sender}} is now signed.
Get your signed copy here (the page issues a fresh download link each time):
{{link}}
`;
const COMPLETION_HTML = `<p>Hello {{name}},</p>
<p>Thank you. &quot;{{title}}&quot; for {{sender}} is now signed.</p>
<p><a href="{{link}}">Get your signed copy</a> (the page issues a fresh download link each time).</p>`;

function build(
	to: string,
	parts: { subject: string; text: string; html: string },
	values: Record<string, string>,
): OutboxMessage {
	const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, oneLine(v)]));
	return {
		to,
		subject: fill(parts.subject, clean, (v) => v),
		text: fill(parts.text, clean, (v) => v),
		html: fill(parts.html, clean, escapeHtml),
	};
}

export function invitationEmail(input: InvitationInput): OutboxMessage {
	const when = input.expiresAt ? `This request expires on ${longDate(input.expiresAt)}.` : "";
	return build(
		input.to,
		{ subject: INVITATION_SUBJECT, text: INVITATION_TEXT, html: INVITATION_HTML },
		{
			name: input.signerName,
			title: input.title,
			sender: input.sender,
			link: input.link,
			expiry: when ? ` ${when}` : "",
		},
	);
}

export function completionEmail(input: CompletionInput): OutboxMessage {
	return build(
		input.to,
		{ subject: COMPLETION_SUBJECT, text: COMPLETION_TEXT, html: COMPLETION_HTML },
		{ name: input.signerName, title: input.title, sender: input.sender, link: input.link },
	);
}
