/**
 * `public/receipts/lookup` (ES-FR-14, protocol §8.3, T062).
 *
 * Request `{ request: <esign-lookup/1 token> }`, verified with the shared verifier (§6.2 steps 1-7;
 * no nonce: lookups are read-only and live 5 minutes). Then the most recent envelope for the token's
 * `(cid, ref)`, only ever among envelopes that `cid` created: `none`, `pending` (not terminal yet) or
 * `terminal` with the receipt, minted from the stored envelope, so a completed envelope's receipt
 * carries `pdfSha256` once the signed PDF is stored.
 *
 * Bridge calls: settings + client (2), the envelopes for the pair (1) = 3.
 */
import { verifyLookupToken } from "@semics-tech/shared";
import type { PluginContext, RouteHandler } from "emdash/plugin";
import type { EnvelopeDoc } from "../domain/envelopes";
import { isTerminal } from "../domain/state";
import { fail, obj, stores } from "./envelopes";
import { integrationClients, mintReceipt } from "./integration";

/** Envelopes read for one `(cid, ref)`, as in from-intent: each retry after a terminal envelope adds one. */
const REF_LIMIT = 100;

/** Envelope ids for a pair end in `_<attempt>` (envelopeIdForRef); a later attempt is a later envelope. */
const attemptOf = (id: string) => Number(/_(\d+)$/.exec(id)?.[1] ?? 0);

function mostRecent(items: ReadonlyArray<{ id: string; data: EnvelopeDoc }>) {
	let best: { id: string; data: EnvelopeDoc } | undefined;
	for (const item of items) {
		if (
			!best ||
			attemptOf(item.id) > attemptOf(best.id) ||
			(attemptOf(item.id) === attemptOf(best.id) && item.data.createdAt > best.data.createdAt)
		) {
			best = item;
		}
	}
	return best;
}

export async function lookupReceipt(input: unknown, ctx: PluginContext, now = Date.now()): Promise<unknown> {
	const clients = integrationClients(ctx);
	const verified = await verifyLookupToken({ token: obj(input).request, now, getClient: clients.getClient });
	if (!verified.ok) return fail(verified.error);
	const { cid, ref } = verified.value;
	const found = await stores(ctx).envelopes.query({ where: { clientId: cid, externalRef: ref }, limit: REF_LIMIT });
	// The query is scoped by cid; the filter keeps that true whatever the storage layer does.
	const latest = mostRecent(found.items.filter((i) => i.data.clientId === cid && i.data.externalRef === ref));
	if (!latest) return { ok: true, state: "none", receipt: null };
	if (!isTerminal(latest.data.status)) return { ok: true, state: "pending", receipt: null };
	const receipt = await mintReceipt(latest.id, latest.data, clients.settings().integrationMasterKey);
	return receipt ? { ok: true, state: "terminal", receipt } : fail("INTERNAL");
}

export const lookupHandler: RouteHandler = (routeCtx, ctx) => lookupReceipt(routeCtx.input, ctx);
