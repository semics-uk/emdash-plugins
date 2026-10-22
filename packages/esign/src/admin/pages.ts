import {
	type ActionElement,
	actions,
	type Block,
	button,
	code,
	context,
	fieldsBlock,
	form,
	header,
	link,
	type NoticeInput,
	notices,
	numberInput,
	renderTemplate,
	secretInput,
	select,
	table,
	templateFields,
	textInput,
	toggle,
} from "@semics-tech/shared";
import type { PluginContext } from "emdash/plugin";

import type { AuditEventDoc } from "../domain/audit";
import { masterKeyTooShort } from "../domain/clients";
import { encryptionKeyStatus, isEncryptionKeyMissingError } from "../domain/encryption-key";
import type { EnvelopeDoc, SignerDoc } from "../domain/envelopes";
import { ENVELOPE_STATUSES, isEnvelopeStatus } from "../domain/state";
import { outboxReport, SITE_URL_WARNING, siteOrigin } from "../emails/outbox";
import { downloadLink } from "../routes/download";
import { ENVELOPE_ROUTES, stores } from "../routes/envelopes";
import { TEMPLATE_ROUTES } from "../routes/templates";
import { createClientAction, generateKey, integrationsPage, revokeClientAction } from "./integrations";

/**
 * Block Kit admin pages (ES-FR-11, ES-US-4), built only with the shared builders.
 *
 * One private `admin` route answers every interaction; `handleAdmin` dispatches on the page path
 * or the action id and returns `{ blocks }`. Envelope and template changes go through the private
 * routes (`envelopes/create|send|resend|void`, `templates/*`), so the status machine and the audit
 * chain are the ones the API uses. Bridge calls per interaction: list 3 (list + outbox status),
 * detail 3 to 4, create 3 + 4, void 4 + 3, resend 6 + 1 (a repair adds 1), settings save 1 + at most
 * 6 writes. `send` is 9 inside the route (T027 queues the invitation), so it answers with a small
 * confirmation instead of re-reading the envelope.
 */
type Reply = Record<string, unknown> & { ok?: boolean; error?: { code?: string; message?: string } };
type RouteFn = (routeCtx: { input?: unknown; user?: { id?: unknown } | null }, ctx: PluginContext) => Promise<Reply>;

export interface AdminDeps {
	ctx: PluginContext;
	/** Site origin: Block Kit external links must be absolute. */
	origin: string;
	now: number;
	/** The host-authenticated admin (`routeCtx.user`), passed to the routes for the audit chain (T117). */
	user?: { id?: unknown } | null;
}

export type AdminInteraction =
	| { type: "page_load"; page: string }
	| { type: "block_action"; action_id: string; page?: string; block_id?: string; value?: unknown }
	| { type: "form_submit"; action_id: string; page?: string; block_id?: string; values: Record<string, unknown> };

export interface AdminResponse {
	blocks: Block[];
}

const respond = (blocks: Block[]): AdminResponse => ({ blocks });
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const run = (deps: AdminDeps, route: unknown, input: unknown): Promise<Reply> =>
	((route as { handler: unknown }).handler as RouteFn)({ input, user: deps.user ?? null }, deps.ctx);

const envelopeRoute = (name: string) => ENVELOPE_ROUTES[name];
const templateRoute = (name: string) => TEMPLATE_ROUTES[name];

// --- messages ---------------------------------------------------------------------------------

const ISSUE_TEXT: Record<string, string> = {
	INVALID_NAME: "Give the template a name of up to 200 characters.",
	INVALID_BODY: "The template text is required (up to 100,000 characters).",
	INVALID_DESCRIPTION: "The description is too long (up to 1,000 characters).",
	TEMPLATE_ARCHIVED: "This template is archived.",
	INVALID_INTEGRATIONS: "Choose whether integrations may use the template.",
	INVALID_TITLE: "The title is too long or has control characters.",
	INVALID_SIGNER_NAME: "Enter the signer's name.",
	INVALID_SIGNER_EMAIL: "Enter a valid email address for the signer.",
	INVALID_FIELDS: "A field value is too long or not text.",
	MISSING_FIELD: "A template field has no value.",
};

function failure(reply: Reply, fallback = "The change was refused."): string {
	const issues = Array.isArray(reply.issues) ? (reply.issues as Array<{ path?: string; code?: string }>) : [];
	if (issues.length > 0) {
		return issues.map((i) => ISSUE_TEXT[i.code ?? ""] ?? `${i.path ?? "input"} (${i.code ?? "invalid"})`).join(" ");
	}
	return reply.error?.message ?? fallback;
}

const error = (title: string, message?: string): NoticeInput => ({
	severity: "error",
	title,
	...(message ? { message } : {}),
});
const back = (id: string, label: string) => button(id, label, { style: "secondary" });

const EVENT_LABELS: Record<string, string> = {
	"envelope.created": "Envelope created",
	"envelope.sent": "Envelope sent",
	"signer.viewed": "Signer opened the document",
	"signer.consented": "Signer gave consent",
	"signer.signed": "Signer signed",
	"signer.declined": "Signer declined",
	"envelope.completed": "Envelope completed",
	"envelope.declined": "Envelope declined",
	"envelope.voided": "Envelope voided",
	"envelope.expired": "Envelope expired",
};

// --- envelopes --------------------------------------------------------------------------------

/** No site URL: emails with links are not queued (T117), and this says why. */
const siteUrlBanner = (deps: AdminDeps): NoticeInput | false =>
	!siteOrigin(deps.ctx) && { severity: "warning", title: "Set the site URL", message: SITE_URL_WARNING };

async function outboxBanners(deps: AdminDeps): Promise<Array<NoticeInput | false>> {
	const report = await outboxReport(deps.ctx);
	return [
		siteUrlBanner(deps),
		report.state === "no_transport" && {
			severity: "warning" as const,
			title: "No email transport",
			message:
				"No email provider is configured, so signing invitations stay queued and are not delivered. Install an email provider plugin.",
		},
		report.failed > 0 && {
			severity: "warning" as const,
			title: `${report.failed} email${report.failed === 1 ? "" : "s"} could not be delivered`,
			message: "Open the envelope and use Resend invitation if a signer never received theirs.",
		},
	];
}

async function envelopesPage(
	deps: AdminDeps,
	status: string,
	extra: Block[] = [],
	cursor?: string,
): Promise<AdminResponse> {
	const filter = isEnvelopeStatus(status) ? status : "";
	const [list, banners] = await Promise.all([
		run(deps, envelopeRoute("envelopes/list"), {
			...(filter ? { status: filter } : {}),
			...(cursor ? { cursor } : {}),
		}),
		outboxBanners(deps),
	]);
	const nextCursor = typeof list.nextCursor === "string" ? list.nextCursor : undefined;
	const rows = ((list.envelopes as Array<Record<string, unknown>>) ?? []).map((e) => {
		const signer = e.signer as { name?: string; email?: string } | undefined;
		return {
			title: e.title,
			signer: signer ? `${signer.name ?? ""} <${signer.email ?? ""}>` : "",
			status: e.status,
			created: e.createdAt,
			open: button("envelope.open", "Open", { value: e.id }),
		};
	});
	return respond([
		header("Envelopes"),
		...notices(banners),
		...extra,
		form({
			fields: [
				select(
					"status",
					"Status",
					[
						{ label: "Any status", value: "" },
						...ENVELOPE_STATUSES.map((s) => ({ label: s.replaceAll("_", " "), value: s })),
					],
					{ initialValue: filter },
				),
			],
			submit: { label: "Filter", actionId: "envelopes.filter" },
		}),
		context("Newest first, 100 a page. Create an envelope from a template on the Templates page."),
		table({
			columns: [
				{ key: "title", label: "Title" },
				{ key: "signer", label: "Signer" },
				{ key: "status", label: "Status", format: "badge" },
				{ key: "created", label: "Created", format: "relative_time" },
				{ key: "open", label: "", format: "element" },
			],
			rows,
			// The filter rides on the action id, the next page's cursor on the value (T034).
			pageActionId: `envelopes.page:${filter}`,
			...(nextCursor ? { nextCursor } : {}),
			emptyText: "No envelopes match.",
		}),
	]);
}

interface SignerView {
	id: string;
	name: string;
	email: string;
	status: string;
}

type InviteState = "queued" | "failed" | "missing" | "n/a";

interface DetailOpts {
	/** The envelope as a route just returned it (saves a read). */
	envelope?: Omit<EnvelopeDoc, "piiSalt">;
	extra?: Block[];
	/** Signers already read by the caller (saves a call). */
	signers?: SignerView[];
	/** Invitation state already known (saves a call). */
	invite?: InviteState;
}

async function inviteState(deps: AdminDeps, signerId: string | undefined): Promise<InviteState> {
	if (!signerId) return "missing";
	const row = await stores(deps.ctx).outbox.get(`invite-${signerId}`);
	if (!row) return "missing";
	return row.status === "failed" ? "failed" : "queued";
}

async function detailPage(deps: AdminDeps, id: string, opts: DetailOpts = {}): Promise<AdminResponse> {
	const { envelopes, signers, audit_events } = stores(deps.ctx);
	const envelope = opts.envelope ?? (await envelopes.get(id));
	if (!envelope) {
		return respond([
			header("Envelope"),
			...notices([error("Envelope not found", "It may have been removed.")]),
			actions([back("envelopes.back", "Back to envelopes")]),
		]);
	}
	const open = envelope.status === "sent" || envelope.status === "in_progress";
	const [events, people, invite] = await Promise.all([
		audit_events.query({ where: { envelopeId: id }, orderBy: { seq: "asc" }, limit: 200 }),
		opts.signers
			? Promise.resolve(opts.signers)
			: envelope.signerIds.length > 0
				? signers.getMany(envelope.signerIds).then((m) =>
						[...m].map(([sid, s]: [string, SignerDoc]) => ({
							id: sid,
							name: s.name,
							email: s.email,
							status: s.status,
						})),
					)
				: Promise.resolve([] as SignerView[]),
		opts.invite ??
			(envelope.status === "sent" ? inviteState(deps, envelope.signerIds[0]) : Promise.resolve("n/a" as const)),
	]);
	const signer = people[0];
	const needsResend = envelope.status === "sent" && (invite === "missing" || invite === "failed");

	// Download link: signed PDF, short-lived, made when the page is drawn.
	let pdf: Block | null = null;
	if (envelope.status === "completed") {
		if (envelope.pdfSha256) {
			const link15 = await downloadLink(deps.ctx, id, deps.now);
			pdf = actions([
				link(
					"Download signed PDF",
					{ kind: "external", url: `${deps.origin}${link15.url}` },
					{ appearance: "primary" },
				),
			]);
		} else {
			pdf = context("The signed PDF is still being prepared. Reload in a minute.");
		}
	}

	const candidates: Array<ActionElement | false> = [
		envelope.status === "draft" && button("envelope.send", "Send for signature", { style: "primary", value: id }),
		needsResend && button("envelope.resend", "Resend invitation", { style: "primary", value: id }),
		(envelope.status === "draft" || open) &&
			button("envelope.void", "Void", {
				style: "danger",
				value: id,
				confirm: {
					title: "Void this envelope?",
					text: "The signer will no longer be able to sign it. This cannot be undone.",
					confirm: "Void envelope",
					deny: "Keep",
					style: "danger",
				},
			}),
		back("envelopes.back", "Back to envelopes"),
	];
	const buttons = candidates.filter((b): b is ActionElement => b !== false);

	return respond([
		header(envelope.title),
		...notices([
			needsResend && {
				severity: "warning",
				title: "The invitation was not delivered",
				message:
					invite === "failed"
						? "The email gave up after repeated failures. Resend invitation queues a fresh email with a new signing link."
						: "The invitation was never queued. Resend invitation queues it with a new signing link.",
			},
			needsResend && siteUrlBanner(deps),
		]),
		...(opts.extra ?? []),
		fieldsBlock([
			{ label: "Status", value: envelope.status.replaceAll("_", " ") },
			{ label: "Template", value: `${envelope.templateId} v${envelope.templateVersion}` },
			{ label: "Signer", value: signer ? `${signer.name} <${signer.email}>` : envelope.signer.email },
			{ label: "Signer status", value: signer?.status ?? "not sent yet" },
			{ label: "Delivery", value: envelope.delivery },
			{ label: "Created", value: envelope.createdAt },
			{ label: "Sent", value: envelope.sentAt ?? "Not sent" },
			{ label: "Expires", value: envelope.expiresAt ?? "Not set" },
			{ label: "Completed", value: envelope.completedAt ?? "Not completed" },
			{ label: "Document SHA-256", value: envelope.docSha256 ?? "Set when sent" },
			{ label: "Final hash", value: envelope.finalHash ?? "Set when completed" },
		]),
		...(pdf ? [pdf] : []),
		actions(buttons),
		header("Audit timeline"),
		table({
			columns: [
				{ key: "seq", label: "#", format: "number" },
				{ key: "event", label: "Event" },
				{ key: "at", label: "When", format: "text" },
				{ key: "actor", label: "By" },
			],
			rows: events.items.map(({ data }: { data: AuditEventDoc }) => ({
				seq: data.seq,
				event: EVENT_LABELS[data.type] ?? data.type,
				at: data.at,
				actor: data.actor,
			})),
			// A Free chain is a handful of events (200 are read); the action just redraws this page (T117).
			pageActionId: `audit.page:${id}`,
			emptyText: "No events yet.",
		}),
	]);
}

async function sendEnvelope(deps: AdminDeps, id: string): Promise<AdminResponse> {
	let reply: Reply;
	try {
		reply = await run(deps, envelopeRoute("envelopes/send"), { id });
	} catch {
		// The route throws after storing the signer when the invitation cannot be queued (T027).
		return respond([
			header("Envelope"),
			...notices([
				error(
					"The envelope was sent but the invitation could not be queued",
					"Open the envelope and use Resend invitation.",
				),
			]),
			actions([button("envelope.open", "Open envelope", { value: id })]),
		]);
	}
	if (reply.ok !== true) {
		return respond([
			header("Envelope"),
			...notices([error("Not sent", failure(reply))]),
			actions([button("envelope.open", "Open envelope", { value: id }), back("envelopes.back", "Back to envelopes")]),
		]);
	}
	const unqueued = reply.invitation === "SITE_URL_MISSING";
	return respond([
		header("Envelope"),
		...notices([
			unqueued
				? { severity: "warning", title: "Envelope sent, but no invitation was queued", message: SITE_URL_WARNING }
				: { severity: "info", title: "Envelope sent", message: "The signer's invitation is queued." },
		]),
		actions([button("envelope.open", "Open envelope", { value: id }), back("envelopes.back", "Back to envelopes")]),
	]);
}

async function voidEnvelope(deps: AdminDeps, id: string): Promise<AdminResponse> {
	const reply = await run(deps, envelopeRoute("envelopes/void"), { id });
	if (reply.ok !== true) {
		const closed = reply.error?.code === "ENVELOPE_CLOSED";
		return detailPage(deps, id, {
			extra: notices([
				error(
					closed ? "This envelope cannot be voided" : "Not voided",
					closed ? "It is already completed, declined, voided or expired." : failure(reply),
				),
			]),
		});
	}
	return detailPage(deps, id, {
		envelope: reply.envelope as DetailOpts["envelope"],
		invite: "n/a",
		extra: notices([{ severity: "info", title: "Voided", message: "The signer can no longer sign this envelope." }]),
	});
}

async function resendInvitation(deps: AdminDeps, id: string): Promise<AdminResponse> {
	const reply = await run(deps, envelopeRoute("envelopes/resend"), { id });
	if (reply.ok !== true) {
		const queued = reply.error?.code === "INVITATION_QUEUED";
		return detailPage(deps, id, {
			extra: notices([
				queued
					? { severity: "info", title: "Already queued", message: "The invitation is queued or was sent." }
					: error("Not resent", failure(reply, "Only an envelope that is sent and unsigned can be resent.")),
			]),
		});
	}
	return detailPage(deps, id, {
		envelope: reply.envelope as DetailOpts["envelope"],
		invite: "queued",
		signers: reply.signers as SignerView[],
		extra: notices([
			{ severity: "info", title: "Invitation queued", message: "A new email with a new signing link is on its way." },
		]),
	});
}

// --- envelope creation ------------------------------------------------------------------------

const BUILT_IN = /^(signer|participant)\./;

async function newEnvelopeForm(deps: AdminDeps, templateId: string, extra: Block[] = []): Promise<AdminResponse> {
	const reply = await run(deps, templateRoute("templates/get"), { id: templateId });
	const tpl = reply.template as { name: string; fields: string[] } | undefined;
	if (reply.ok !== true || !tpl) {
		return respond([header("New envelope"), ...notices([error("Template not found")]), ...extra]);
	}
	return respond([
		header(`New envelope: ${tpl.name}`),
		...extra,
		context(
			"Creates a draft you can check before sending it for signature. Signer fields: one per line as key: Label, ending in * when required.",
		),
		form({
			fields: [
				textInput("title", "Title", { initialValue: tpl.name }),
				textInput("signerName", "Signer name"),
				textInput("signerEmail", "Signer email"),
				...tpl.fields.filter((f) => !BUILT_IN.test(f)).map((f) => textInput(`field:${f}`, f)),
				textInput("signerFields", "Fields the signer fills in (optional)", {
					multiline: true,
					placeholder: "phone: Phone number *",
				}),
			],
			submit: { label: "Create draft", actionId: "envelope.create" },
			blockId: `envelope-new:${templateId}`,
		}),
		actions([back("templates.back", "Back to templates")]),
	]);
}

/**
 * The form's signer-fields text (T033 `signerFields`, T034): one field per line, `key: Label`, a trailing
 * `*` for a required one. Blank lines are skipped; anything else is passed on as written so
 * `envelopes/create` reports it (`INVALID_FIELDS`) rather than it being silently dropped.
 */
export function parseSignerFields(value: unknown): Array<{ key: string; label: string; required?: boolean }> {
	if (typeof value !== "string") return [];
	return value
		.slice(0, 4000)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => {
			const at = line.indexOf(":");
			const key = (at === -1 ? line : line.slice(0, at)).trim();
			let label = at === -1 ? "" : line.slice(at + 1).trim();
			const required = label.endsWith("*");
			if (required) label = label.slice(0, -1).trim();
			return { key, label, ...(required ? { required: true } : {}) };
		});
}

async function createEnvelope(
	deps: AdminDeps,
	blockId: string | undefined,
	values: Record<string, unknown>,
): Promise<AdminResponse> {
	const templateId = blockId?.startsWith("envelope-new:") ? blockId.slice(13) : "";
	if (!templateId) return respond(notices([error("Choose a template first")]));
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		if (key.startsWith("field:")) fields[key.slice(6)] = typeof value === "string" ? value : "";
	}
	const title = str(values.title);
	const signerFields = parseSignerFields(values.signerFields);
	const reply = await run(deps, envelopeRoute("envelopes/create"), {
		templateId,
		...(title ? { title } : {}),
		signer: { name: str(values.signerName), email: str(values.signerEmail) },
		fields,
		...(signerFields.length > 0 ? { signerFields } : {}),
	});
	if (reply.ok !== true) {
		return newEnvelopeForm(deps, templateId, notices([error("Not saved", failure(reply))]));
	}
	const id = (reply.envelope as { id: string }).id;
	return detailPage(deps, id, {
		extra: notices([{ severity: "info", title: "Draft created", message: "Check the details, then send it." }]),
	});
}

// --- templates --------------------------------------------------------------------------------

async function templatesPage(deps: AdminDeps, extra: Block[] = []): Promise<AdminResponse> {
	const reply = await run(deps, templateRoute("templates/list"), {});
	const rows = ((reply.templates as Array<Record<string, unknown>>) ?? []).map((t) => ({
		name: t.name,
		version: t.version,
		fields: ((t.fields as string[]) ?? []).join(", "),
		integrations: t.integrations === true ? "Yes" : "No",
		updated: t.updatedAt,
		edit: button("template.edit", "Edit", { value: t.id }),
		use: button("envelope.new", "New envelope", { style: "primary", value: t.id }),
	}));
	return respond([
		header("Templates"),
		...extra,
		table({
			columns: [
				{ key: "name", label: "Name" },
				{ key: "version", label: "Version", format: "number" },
				{ key: "fields", label: "Fields" },
				{ key: "integrations", label: "Integrations" },
				{ key: "updated", label: "Updated", format: "relative_time" },
				{ key: "edit", label: "", format: "element" },
				{ key: "use", label: "", format: "element" },
			],
			rows,
			pageActionId: "templates.page",
			emptyText: "No templates yet. Add one below.",
		}),
		header("New template"),
		context(
			"Write the document in Markdown. Use {{field}} for values filled in per envelope, and {{signer.name}} for the signer.",
		),
		form({
			fields: [
				textInput("name", "Name"),
				textInput("description", "Description (optional)"),
				textInput("body", "Template text", { multiline: true }),
				integrationsToggle(false),
			],
			submit: { label: "Create template", actionId: "template.create" },
		}),
	]);
}

/** "Available to integrations" (T061): only flagged templates accept signing intents (protocol §8.1). */
function integrationsToggle(initialValue: boolean) {
	return toggle("integrations", "Available to integrations", {
		description: "Paired sites (such as Events) may send this template for signing.",
		initialValue,
	});
}

function previewOf(body: string): string {
	const sample = Object.fromEntries(templateFields(body).map((f) => [f, `«${f}»`]));
	try {
		return renderTemplate(body, sample);
	} catch {
		return body;
	}
}

function templateEditor(id: string, tpl: Record<string, unknown>, extra: Block[] = []): AdminResponse {
	const body = String(tpl.body ?? "");
	const fields = templateFields(body);
	return respond([
		header(`Edit template: ${String(tpl.name ?? "")}`),
		...extra,
		context(
			`Version ${String(tpl.version ?? 1)}. Saving writes a new version; sent envelopes keep the text they were sent with.`,
		),
		form({
			fields: [
				textInput("name", "Name", { initialValue: String(tpl.name ?? "") }),
				textInput("description", "Description (optional)", { initialValue: String(tpl.description ?? "") }),
				textInput("body", "Template text", { initialValue: body, multiline: true }),
				integrationsToggle(tpl.integrations === true),
			],
			submit: { label: "Save new version", actionId: "template.save" },
			blockId: `template:${id}`,
		}),
		header("Preview"),
		context(
			fields.length > 0 ? `Fields: ${fields.join(", ")}. Placeholders show as «name».` : "This template has no fields.",
		),
		code({ code: previewOf(body) }),
		actions([
			button("envelope.new", "New envelope from this template", { style: "primary", value: id }),
			button("template.archive", "Archive", {
				style: "danger",
				value: id,
				confirm: {
					title: "Archive this template?",
					text: "It can no longer be used for new envelopes. Sent envelopes are not affected.",
					confirm: "Archive",
					deny: "Keep",
					style: "danger",
				},
			}),
			back("templates.back", "Back to templates"),
		]),
	]);
}

async function openTemplate(deps: AdminDeps, id: string, extra: Block[] = []): Promise<AdminResponse> {
	const reply = await run(deps, templateRoute("templates/get"), { id });
	if (reply.ok !== true || !reply.template) {
		return templatesPage(deps, notices([error("Template not found")]));
	}
	return templateEditor(id, reply.template as Record<string, unknown>, extra);
}

async function createTemplate(deps: AdminDeps, v: Record<string, unknown>): Promise<AdminResponse> {
	const reply = await run(deps, templateRoute("templates/create"), {
		name: str(v.name),
		body: typeof v.body === "string" ? v.body : "",
		...(str(v.description, 1000) ? { description: str(v.description, 1000) } : {}),
		integrations: v.integrations === true,
	});
	if (reply.ok !== true) return templatesPage(deps, notices([error("Not saved", failure(reply))]));
	return templatesPage(deps, notices([{ severity: "info", title: "Template created" }]));
}

async function saveTemplate(
	deps: AdminDeps,
	blockId: string | undefined,
	v: Record<string, unknown>,
): Promise<AdminResponse> {
	const id = blockId?.startsWith("template:") ? blockId.slice(9) : "";
	if (!id) return respond(notices([error("Choose a template first")]));
	const input = {
		name: str(v.name),
		body: typeof v.body === "string" ? v.body : "",
		description: str(v.description, 1000),
		integrations: v.integrations === true,
	};
	const reply = await run(deps, templateRoute("templates/update"), { id, ...input });
	if (reply.ok !== true) {
		return templateEditor(id, { ...input, version: "?" }, notices([error("Not saved", failure(reply))]));
	}
	return templateEditor(id, reply.template as Record<string, unknown>, notices([{ severity: "info", title: "Saved" }]));
}

async function archiveTemplate(deps: AdminDeps, id: string): Promise<AdminResponse> {
	const reply = await run(deps, templateRoute("templates/archive"), { id });
	return templatesPage(
		deps,
		notices([
			reply.ok === true ? { severity: "info", title: "Template archived" } : error("Not archived", failure(reply)),
		]),
	);
}

// --- settings ---------------------------------------------------------------------------------

type SettingKind = "text" | "long" | "number";
const PLAIN_SETTINGS: Array<{ key: string; label: string; kind: SettingKind; min?: number; max?: number }> = [
	{ key: "senderName", label: "Sender name", kind: "text" },
	{ key: "expiryDays", label: "Envelope expiry (days)", kind: "number", min: 1, max: 365 },
	{ key: "consentVersion", label: "Consent version", kind: "text" },
	{ key: "consentWording", label: "Consent wording", kind: "long" },
	{ key: "retentionPersonalDataMonths", label: "Keep personal data (months)", kind: "number", min: 1, max: 120 },
	{ key: "retentionSignedRecordsYears", label: "Keep signed records (years)", kind: "number", min: 1, max: 50 },
	{ key: "turnstileSiteKey", label: "Turnstile site key", kind: "text" },
];
const SECRET_SETTINGS = [
	{ key: "turnstileSecretKey", label: "Turnstile secret key" },
	{ key: "integrationMasterKey", label: "Integration master key" },
];
const MAX_SETTING_WRITES = 6;

type SecretState = "unset" | "readable" | "unreadable";
const secretState = (v: unknown): SecretState =>
	typeof v === "string" && v !== "" ? "readable" : v !== null && typeof v === "object" ? "unreadable" : "unset";

function settingsView(values: Record<string, unknown>, secrets: Record<string, SecretState>, extra: Block[] = []) {
	const unreadable = SECRET_SETTINGS.some((s) => secrets[s.key] === "unreadable");
	const missing = encryptionKeyStatus(null).banner;
	return respond([
		header("Settings"),
		...notices([
			unreadable && missing && { severity: "error", title: "Encryption key missing", message: missing.message },
			secrets.integrationMasterKey === "unset" && {
				severity: "warning",
				title: "Integration master key not set",
				message: "Other plugins cannot create envelopes through the integration protocol until it is saved.",
			},
		]),
		...extra,
		form({
			fields: [
				...PLAIN_SETTINGS.map((s) =>
					s.kind === "number"
						? numberInput(s.key, s.label, {
								min: s.min,
								max: s.max,
								...(typeof values[s.key] === "number" ? { initialValue: values[s.key] as number } : {}),
							})
						: textInput(s.key, s.label, {
								multiline: s.kind === "long",
								initialValue: typeof values[s.key] === "string" ? (values[s.key] as string) : "",
							}),
				),
				...SECRET_SETTINGS.map((s) =>
					secretInput(s.key, `${s.label} (leave blank to keep)`, { hasValue: secrets[s.key] === "readable" }),
				),
			],
			submit: { label: "Save settings", actionId: "settings.save" },
		}),
		context("Reminder and one-time-code settings (Pro) are in the plugin's own settings panel."),
	]);
}

async function readSettings(deps: AdminDeps) {
	const entries = await deps.ctx.settings.list();
	const values = Object.fromEntries(entries.map((e) => [e.key, e.value]));
	const secrets = Object.fromEntries(SECRET_SETTINGS.map((s) => [s.key, secretState(values[s.key])])) as Record<
		string,
		SecretState
	>;
	return { values, secrets };
}

async function settingsPage(deps: AdminDeps): Promise<AdminResponse> {
	const { values, secrets } = await readSettings(deps);
	return settingsView(values, secrets);
}

async function saveSettings(deps: AdminDeps, input: Record<string, unknown>): Promise<AdminResponse> {
	const { values, secrets } = await readSettings(deps);
	const changes: Array<[string, unknown]> = [];
	const problems: string[] = [];
	for (const s of PLAIN_SETTINGS) {
		const raw = input[s.key];
		if (raw === undefined || raw === null || raw === "") continue;
		let next: string | number;
		if (s.kind === "number") {
			next = Number(raw);
			if (!Number.isInteger(next) || next < (s.min ?? 0) || next > (s.max ?? Number.MAX_SAFE_INTEGER)) {
				problems.push(`${s.label} must be a whole number from ${s.min} to ${s.max}.`);
				continue;
			}
		} else {
			next = str(raw, s.kind === "long" ? 2000 : 200);
		}
		if (next !== values[s.key]) changes.push([s.key, next]);
	}
	const secretChanges = SECRET_SETTINGS.filter((s) => str(input[s.key], 500) !== "");
	// T060: a typed master key must be at least 32 bytes (a generated one always is).
	if (secretChanges.some((s) => s.key === "integrationMasterKey" && masterKeyTooShort(str(input[s.key], 500)))) {
		problems.push(
			"The integration master key must be at least 32 characters, or use Generate on the Integrations page.",
		);
	}
	if (problems.length > 0) return settingsView(values, secrets, notices([error("Not saved", problems.join(" "))]));
	if (changes.length + secretChanges.length > MAX_SETTING_WRITES) {
		return settingsView(
			values,
			secrets,
			notices([error("Too many changes at once", `Save at most ${MAX_SETTING_WRITES} settings at a time.`)]),
		);
	}
	if (changes.length + secretChanges.length === 0) {
		return settingsView(values, secrets, notices([{ severity: "info", title: "Nothing to save" }]));
	}

	const next = { ...values };
	const nextSecrets = { ...secrets };
	try {
		// Secrets first: a missing encryption key stops the save before anything is half written.
		for (const s of secretChanges) {
			await deps.ctx.settings.set(s.key, str(input[s.key], 500));
			nextSecrets[s.key] = "readable";
		}
		for (const [key, value] of changes) {
			await deps.ctx.settings.set(key, value);
			next[key] = value;
		}
	} catch (e) {
		if (!isEncryptionKeyMissingError(e)) throw e;
		const banner = encryptionKeyStatus(null).banner;
		return settingsView(
			values,
			secrets,
			notices([{ severity: "error", title: "Encryption key missing", message: banner?.message }]),
		);
	}
	return settingsView(next, nextSecrets, notices([{ severity: "info", title: "Saved" }]));
}

// --- dispatch ---------------------------------------------------------------------------------

const idOf = (value: unknown): string => str(value, 200);

export async function handleAdmin(deps: AdminDeps, interaction: AdminInteraction): Promise<AdminResponse> {
	if (interaction.type === "page_load") {
		switch (interaction.page) {
			case "/envelopes":
				return envelopesPage(deps, "");
			case "/templates":
				return templatesPage(deps);
			case "/settings":
				return settingsPage(deps);
			case "/integrations":
				return integrationsPage(deps);
			default:
				return respond(notices([error("Page not found")]));
		}
	}

	if (interaction.type === "form_submit") {
		const v = interaction.values;
		switch (interaction.action_id) {
			case "envelopes.filter":
				return envelopesPage(deps, str(v.status));
			case "envelope.create":
				return createEnvelope(deps, interaction.block_id, v);
			case "template.create":
				return createTemplate(deps, v);
			case "template.save":
				return saveTemplate(deps, interaction.block_id, v);
			case "settings.save":
				return saveSettings(deps, v);
			case "client.create":
				return createClientAction(deps, v);
		}
	} else {
		const id = idOf(interaction.value);
		if (interaction.action_id.startsWith("envelopes.page:")) {
			return envelopesPage(deps, interaction.action_id.slice(15), [], str(interaction.value, 500) || undefined);
		}
		if (interaction.action_id.startsWith("audit.page:")) return detailPage(deps, idOf(interaction.action_id.slice(11)));
		switch (interaction.action_id) {
			case "envelopes.back":
			case "envelopes.page":
				return envelopesPage(deps, "");
			case "envelope.open":
				return detailPage(deps, id);
			case "envelope.send":
				return sendEnvelope(deps, id);
			case "envelope.void":
				return voidEnvelope(deps, id);
			case "envelope.resend":
				return resendInvitation(deps, id);
			case "envelope.new":
				return newEnvelopeForm(deps, id);
			case "integrations.generate-key":
				return generateKey(deps);
			case "client.revoke":
				return revokeClientAction(deps, id);
			case "clients.page":
				return integrationsPage(deps);
			case "templates.back":
			case "templates.page":
				return templatesPage(deps);
			case "template.edit":
				return openTemplate(deps, id);
			case "template.archive":
				return archiveTemplate(deps, id);
		}
	}
	return respond(notices([error("Unknown action")]));
}
