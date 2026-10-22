// e2e-only (T056): the emails the site delivered (src/e2e/mail-capture.mjs), newest last.
//   GET /e2e/mail?to=<address>   only the messages to that address
import { mailbox } from "../../e2e/mail-capture.mjs";

export const prerender = false;

export function GET({ url }: { url: URL }): Response {
	// Not on a deployed (Cloudflare) build: the captured emails are for the local e2e server only (T111).
	if (!import.meta.env.PLAYGROUND_E2E_HELPERS) return new Response(null, { status: 404 });
	const to = url.searchParams.get("to");
	const messages = mailbox().filter((m: { to: string }) => !to || m.to === to);
	return new Response(JSON.stringify({ messages }), {
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});
}
