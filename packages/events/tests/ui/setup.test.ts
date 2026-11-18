/**
 * The setup check page, `/_events/setup` (EV-FR-01, T040, T047; moved from the admin page in T178).
 *
 * The page runs on the site, not in the sandbox, so the check costs the Free backend no bytes. It asks
 * the host's own handlers with the visitor's session: the plugin-settings read (which checks
 * `plugins:manage`) and the schema read (`schema:read`). Secrets come back from the settings read as
 * set or not set only (`secretsSet`); a set one is decrypted on the server to tell readable from
 * unreadable, and only that outcome reaches the page.
 */
import { describe, expect, it } from "vitest";

import { SETUP_PATH, type SetupContext, setupCheck } from "../../src/astro/lib/setup";

const SECRET = "0x4AAA-very-secret-value";

const VALUES = {
	eventsCollection: "events",
	fieldStartsAt: "starts_at",
	fieldEndsAt: "ends_at",
	fieldTimezone: "timezone",
	fieldVenue: "venue",
	turnstileSiteKey: "0x4AAA-site",
};
const COLLECTIONS = [
	{ slug: "events", fields: ["title", "starts_at", "ends_at", "timezone", "venue"].map((slug) => ({ slug })) },
	{ slug: "posts", fields: [{ slug: "title" }] },
];

const ok = (data: unknown) => Response.json({ success: true, data });
const denied = (status: number) =>
	Response.json(
		{ success: false, error: { code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", message: "no" } },
		{ status },
	);

interface World {
	values?: Record<string, unknown>;
	secretsSet?: Record<string, boolean>;
	/** Stored secrets as `getPluginSetting` would give them; an Error is thrown (cannot be decrypted). */
	stored?: Record<string, unknown>;
	collections?: unknown[];
	settings?: Response;
	schema?: Response;
}

function world(w: World = {}) {
	const asked: string[] = [];
	const stored = w.stored ?? { turnstileSecretKey: SECRET };
	const ctx: SetupContext = {
		locals: { user: { id: "u1", role: 50 } },
		readSettings: async () => {
			asked.push("settings");
			return (
				w.settings ??
				ok({
					schema: {},
					values: { ...VALUES, ...w.values },
					secretsSet: w.secretsSet ?? { turnstileSecretKey: true, esignPairing: false },
				})
			);
		},
		readSchema: async () => {
			asked.push("schema");
			return w.schema ?? ok({ collections: w.collections ?? COLLECTIONS, version: "v1" });
		},
		readSecret: async (key) => {
			asked.push(`secret:${key}`);
			const value = stored[key];
			if (value instanceof Error) throw value;
			return value;
		},
	};
	return { ctx, asked };
}

describe("/_events/setup (T178)", () => {
	it("T178 lives at /_events/setup", () => {
		expect(SETUP_PATH).toBe("/_events/setup");
	});

	it("T178 a signed-out visitor is refused before anything is read", async () => {
		for (const locals of [{}, { user: null }, null, undefined]) {
			const { ctx, asked } = world();
			ctx.locals = locals;
			expect(await setupCheck(ctx)).toEqual({ state: "forbidden" });
			expect(asked).toEqual([]);
		}
	});

	it("T178 a visitor the host refuses gets nothing: no schema, no secret is read", async () => {
		for (const status of [401, 403]) {
			const { ctx, asked } = world({ settings: denied(status) });
			expect(await setupCheck(ctx)).toEqual({ state: "forbidden" });
			expect(asked).toEqual(["settings"]);
		}
	});

	it("T178 a host error reads as an error, not as a passed check", async () => {
		const { ctx } = world({ settings: Response.json({ success: false }, { status: 500 }) });
		expect((await setupCheck(ctx)).state).toBe("error");
		const schema = world({ schema: Response.json({ success: false }, { status: 500 }) });
		expect((await setupCheck(schema.ctx)).state).toBe("error");
		const thrown = world();
		thrown.ctx.readSettings = async () => {
			throw new Error("boom");
		};
		expect((await setupCheck(thrown.ctx)).state).toBe("error");
	});

	it("EV-FR-01 a sound mapping and a readable Turnstile secret show no notices, and the mapping fields", async () => {
		const { ctx } = world();
		const view = await setupCheck(ctx);
		expect(view).toEqual({
			state: "ok",
			notices: [],
			fields: [
				{ label: "Events collection", value: "events" },
				{ label: "Start field", value: "starts_at" },
				{ label: "End field", value: "ends_at" },
				{ label: "Timezone field", value: "timezone" },
				{ label: "Venue field", value: "venue" },
			],
		});
	});

	it("EV-FR-01 shows the mapping notice when a mapped field is missing from the collection", async () => {
		const { ctx } = world({ values: { fieldVenue: "place" } });
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.notices).toHaveLength(1);
		expect(view.notices[0]).toMatchObject({ severity: "error", title: "Events field mapping needs attention" });
		expect(view.notices[0]?.message).toContain('"place"');
		expect(view.fields.find((f) => f.label === "Venue field")?.value).toBe("place");
	});

	it("EV-FR-01 an unset mapping value falls back to the default, and an empty one reads (not set)", async () => {
		const { ctx } = world({ values: { eventsCollection: null, fieldVenue: "" } });
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.fields[0]).toEqual({ label: "Events collection", value: "events" });
		expect(view.fields.find((f) => f.label === "Venue field")?.value).toBe("(not set)");
		expect(view.notices).toEqual([]);
	});

	it("EV-FR-01 names the collections there are when the mapped one does not exist", async () => {
		const { ctx } = world({ values: { eventsCollection: "gigs" } });
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.notices[0]?.message).toContain('"gigs" does not exist');
		expect(view.notices[0]?.message).toContain("Available: events, posts.");
	});

	it("S8 shows the encryption key notice when a saved secret cannot be decrypted", async () => {
		const { ctx } = world({
			secretsSet: { turnstileSecretKey: true, esignPairing: true },
			stored: { turnstileSecretKey: SECRET, esignPairing: new Error("PLUGIN_SETTING_DECRYPTION_FAILED") },
		});
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.notices).toEqual([
			expect.objectContaining({ severity: "error", title: "Saved secrets cannot be read" }),
		]);
		expect(view.notices[0]?.message).toContain("esignPairing cannot be decrypted");
		expect(view.notices[0]?.message).not.toContain("turnstileSecretKey");
	});

	it("S8 a set secret that comes back as something other than text is unreadable too", async () => {
		const { ctx } = world({ stored: { turnstileSecretKey: { $emdash: "plugin-setting" } } });
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.notices.map((n) => n.title)).toEqual(["Saved secrets cannot be read"]);
	});

	it("S8 decrypts only the secrets the host says are set, and never puts a secret value in the view", async () => {
		const { ctx, asked } = world();
		const view = await setupCheck(ctx);
		expect(asked).toEqual(["settings", "schema", "secret:turnstileSecretKey"]);
		expect(JSON.stringify(view)).not.toContain(SECRET);
		expect(JSON.stringify(view)).not.toContain("0x4AAA");
	});

	it("T047 warns that checkout runs without a bot check when no Turnstile secret is set", async () => {
		const { ctx, asked } = world({ secretsSet: { turnstileSecretKey: false, esignPairing: false }, stored: {} });
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.notices).toEqual([
			{
				severity: "warning",
				title: "Turnstile is not set up",
				message: "Checkout runs without a bot check; add the Turnstile keys.",
			},
		]);
		expect(asked).not.toContain("secret:turnstileSecretKey");
	});

	it("T178 shows the mapping, encryption and Turnstile notices together, in that order", async () => {
		const { ctx } = world({
			values: { fieldStartsAt: "" },
			secretsSet: { turnstileSecretKey: false, esignPairing: true },
			stored: { esignPairing: new Error("PLUGIN_SETTING_ENCRYPTION_KEY_UNKNOWN") },
		});
		const view = await setupCheck(ctx);
		if (view.state !== "ok") throw new Error(view.state);
		expect(view.notices.map((n) => n.title)).toEqual([
			"Events field mapping needs attention",
			"Saved secrets cannot be read",
			"Turnstile is not set up",
		]);
	});
});
