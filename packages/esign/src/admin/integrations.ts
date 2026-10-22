import {
	actions,
	type Block,
	button,
	code,
	context,
	form,
	header,
	type NoticeInput,
	notices,
	table,
	textInput,
} from "@semics-tech/shared";

import {
	type ClientDoc,
	type ClientStore,
	createClient,
	generateMasterKey,
	listClients,
	parseAllowlist,
	revokeClient,
} from "../domain/clients";
import { encryptionKeyStatus, isEncryptionKeyMissingError } from "../domain/encryption-key";
import { masterKeyBytes } from "../domain/master-key";
import { stores } from "../routes/envelopes";
import type { AdminDeps, AdminResponse } from "./pages";

/**
 * Integrations page (T060, ES-FR-12): create an integration client, list, revoke. Block Kit only.
 *
 * Secrets: a client's secret is derived from `integrationMasterKey` (Spike S8) and never stored.
 * The pairing string is built in the response to `client.create` and is in no other response; the
 * page never shows a secret and never reads one back. Bridge calls: page load 2 (settings +
 * clients), create 3 (settings, put, clients), revoke 3, generate-key 3. The actions run through
 * EmDash's own admin API, which is the CSRF-protected path (no public route is involved).
 */
const respond = (blocks: Block[]): AdminResponse => ({ blocks });
const error = (title: string, message?: string): NoticeInput => ({
	severity: "error",
	title,
	...(message ? { message } : {}),
});
const clientStore = (deps: AdminDeps) => stores(deps.ctx).clients as unknown as ClientStore;

async function masterKey(deps: AdminDeps): Promise<unknown> {
	const entries = await deps.ctx.settings.list();
	return entries.find((e) => e.key === "integrationMasterKey")?.value;
}

const keyIsSet = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";

function view(key: unknown, clients: ClientDoc[], extra: Block[] = []): AdminResponse {
	const usable = masterKeyBytes(key) !== null;
	const unreadable = key !== null && typeof key === "object";
	const missing = encryptionKeyStatus(null).banner;
	return respond([
		header("Integrations"),
		...notices([
			unreadable && missing && { severity: "error", title: "Encryption key missing", message: missing.message },
			!usable &&
				!unreadable && {
					severity: "warning",
					title: keyIsSet(key) ? "Integration master key is too short" : "Integration master key not set",
					message:
						"Clients are paired with secrets derived from the master key. Generate one here, or save one of at least 32 characters in Settings.",
				},
		]),
		...extra,
		...(usable || unreadable || keyIsSet(key)
			? []
			: [actions([button("integrations.generate-key", "Generate master key", { style: "primary" })])]),
		header("Clients"),
		table({
			columns: [
				{ key: "name", label: "Name" },
				{ key: "clientId", label: "Client id" },
				{ key: "created", label: "Created", format: "relative_time" },
				{ key: "status", label: "Status", format: "badge" },
				{ key: "revoke", label: "", format: "element" },
			],
			rows: clients.map((c) => ({
				name: c.name,
				clientId: c.clientId,
				created: c.createdAt,
				status: c.revokedAt ? "Revoked" : "Active",
				...(c.revokedAt
					? {}
					: {
							revoke: button("client.revoke", "Revoke", {
								style: "danger",
								value: c.clientId,
								confirm: {
									title: "Revoke this client?",
									text: "Its intents and receipts are refused from now on. This cannot be undone; create a new client to pair again.",
									confirm: "Revoke client",
									deny: "Keep",
									style: "danger",
								},
							}),
						}),
			})),
			pageActionId: "clients.page",
			emptyText: "No clients yet.",
		}),
		header("Add a client"),
		context(
			"The pairing string is shown once, right after you create the client, and cannot be shown again. Paste it into the other plugin's settings. Return URLs: one per line, https (http only for localhost); leave blank to allow this site only.",
		),
		form({
			fields: [
				textInput("name", "Name", { initialValue: "" }),
				textInput("returnUrlAllowlist", "Allowed return URLs", { multiline: true, initialValue: "" }),
			],
			submit: { label: "Create client", actionId: "client.create" },
		}),
	]);
}

async function render(deps: AdminDeps, key: unknown, extra: Block[] = []): Promise<AdminResponse> {
	return view(key, await listClients(clientStore(deps)), extra);
}

export async function integrationsPage(deps: AdminDeps): Promise<AdminResponse> {
	const [key, clients] = await Promise.all([masterKey(deps), listClients(clientStore(deps))]);
	return view(key, clients);
}

export async function generateKey(deps: AdminDeps): Promise<AdminResponse> {
	const key = await masterKey(deps);
	if (keyIsSet(key)) {
		return render(deps, key, notices([error("Key already set", "Changing it would re-pair every client.")]));
	}
	const next = generateMasterKey();
	try {
		await deps.ctx.settings.set("integrationMasterKey", next);
	} catch (e) {
		if (!isEncryptionKeyMissingError(e)) throw e;
		return render(deps, key, notices([error("Encryption key missing", encryptionKeyStatus(null).banner?.message)]));
	}
	return render(deps, next, notices([{ severity: "info", title: "Master key generated" }]));
}

export async function createClientAction(deps: AdminDeps, values: Record<string, unknown>): Promise<AdminResponse> {
	const key = await masterKey(deps);
	const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
	const allowlist = parseAllowlist(text(values.returnUrlAllowlist, 2000));
	if (!allowlist.ok) {
		return render(
			deps,
			key,
			notices([error("Not created", `Return URL not allowed: ${allowlist.entry.slice(0, 200)}`)]),
		);
	}
	const result = await createClient(
		clientStore(deps),
		{ name: text(values.name, 200), returnUrlAllowlist: allowlist.entries, masterKey: key },
		{ now: new Date(deps.now).toISOString() },
	);
	if (!result.ok) {
		const message =
			result.code === "MASTER_KEY_MISSING"
				? "Set the integration master key first (at least 32 characters), or generate one."
				: "Give the client a name of up to 100 characters.";
		return render(deps, key, notices([error("Not created", message)]));
	}
	return render(deps, key, [
		...notices([
			{
				severity: "warning",
				title: "Copy the pairing string now",
				message: "It is shown only this once and cannot be recovered. Treat it like a password.",
			},
		]),
		code({ code: result.pairing }),
	]);
}

export async function revokeClientAction(deps: AdminDeps, clientId: string): Promise<AdminResponse> {
	const store = clientStore(deps);
	const done = await revokeClient(store, clientId, new Date(deps.now).toISOString());
	const key = await masterKey(deps);
	return render(
		deps,
		key,
		notices([
			done ? { severity: "info", title: "Client revoked" } : error("Not revoked", "Unknown or already revoked."),
		]),
	);
}
