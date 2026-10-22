// e2e-only email provider (T056). EmDash registers its dev console provider only under `astro dev`;
// the e2e server is a production build, so without a provider `ctx.email.send` has nowhere to go.
// This trusted plugin is the site's one `email:deliver` provider: it keeps the delivered messages
// in memory (newest last, capped) for `/e2e/mail` to read back. The messages are exactly what the
// events core rendered at send time, after the outbox drain, so tests see the real email.
import { definePlugin } from "emdash";

export const MAIL_CAPTURE_ID = "e2e-mail-capture";
const KEY = Symbol.for("playground:e2e-mail");
const MAX = 500;

/** The captured messages, shared through globalThis (the plugin and the page may load separate module copies). */
export function mailbox() {
	globalThis[KEY] ??= [];
	return globalThis[KEY];
}

/** Descriptor for `plugins: [...]` in astro.config.mjs. */
export function mailCapture() {
	return {
		id: MAIL_CAPTURE_ID,
		version: "0.0.0",
		entrypoint: new URL(import.meta.url).pathname,
	};
}

export function createPlugin() {
	return definePlugin({
		id: MAIL_CAPTURE_ID,
		version: "0.0.0",
		capabilities: ["hooks.email-transport:register"],
		hooks: {
			"email:deliver": {
				exclusive: true,
				handler: async ({ message, source }) => {
					const box = mailbox();
					box.push({ ...message, source, sentAt: new Date().toISOString() });
					while (box.length > MAX) box.shift();
				},
			},
		},
	});
}

export default createPlugin;
