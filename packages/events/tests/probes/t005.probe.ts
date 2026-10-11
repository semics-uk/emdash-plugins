import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterAll, afterEach, describe, expect, it } from "vitest";

let host: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const findings: string[] = [];
const finding = (id: string, value: unknown) => findings.push(`FINDING ${id} ${JSON.stringify(value)}`);
afterAll(() => {
	console.log(findings.join("\n"));
});
const route = async (h: PluginRuntimeTestHost, name: string, input: unknown) =>
	(await h.transport.invokeRoute(name, input)) as Record<string, unknown>;

describe("S3 one-shot cron", () => {
	it("an ISO-datetime schedule fires exactly once and is then removed", async () => {
		host = await createPluginRuntimeTestHost();
		const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		const scheduled = await route(host, "cron/schedule", { name: "hold-abc", schedule: at });
		expect(scheduled.ok).toBe(true);
		const tasks = await host.inspect.scheduledTasks();
		finding("S3.task", tasks);
		expect(tasks).toHaveLength(1);

		// Not yet due: nothing fires.
		const early = await host.scheduled.run();
		expect(early.processed).toBe(0);

		host.scheduled.setTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
		// The cron executor reads wall-clock time unless the runtime was given a clock; advance by scheduling in the past instead.
		const first = await host.scheduled.run();
		finding("S3.first", first);
		const second = await host.scheduled.run();
		finding("S3.second", second);
		const count = (await route(host, "kv/get", { key: "cron:hold-abc" })).value;
		finding("S3.count", count);
		expect(count).toBe(1);
		expect(await host.inspect.scheduledTasks()).toHaveLength(0);
	});

	it("a past ISO datetime fires on the next tick; limits and name reuse", async () => {
		host = await createPluginRuntimeTestHost();
		const past = new Date(Date.now() - 1000).toISOString();
		for (let i = 0; i < 12; i++) await route(host, "cron/schedule", { name: `t${i}`, schedule: past });
		const a = await host.scheduled.run();
		const b = await host.scheduled.run();
		finding("S3.batch", { first: a.processed, second: b.processed });
		expect(a.processed).toBe(10);
		expect(b.processed).toBe(2);

		// Same task name replaces the pending task (upsert on plugin_id + task_name).
		const future = new Date(Date.now() + 3_600_000).toISOString();
		await route(host, "cron/schedule", { name: "same", schedule: future });
		await route(host, "cron/schedule", { name: "same", schedule: future });
		expect(await host.inspect.scheduledTasks()).toHaveLength(1);

		// Invalid schedules and names are rejected at schedule time.
		const bad = await route(host, "cron/schedule", { name: "bad name", schedule: future });
		finding("S3.badName", bad);
		expect(bad.ok).toBe(false);
		const badSched = await route(host, "cron/schedule", { name: "x", schedule: "tomorrow-ish" });
		finding("S3.badSchedule", badSched);
		expect(badSched.ok).toBe(false);
		const sixField = await route(host, "cron/schedule", { name: "sec", schedule: "*/10 * * * * *" });
		finding("S3.sixField", sixField.ok);
		expect(sixField.ok).toBe(true);
	});
});

describe("S4 storage document size", () => {
	it("finds the largest document that round-trips", async () => {
		host = await createPluginRuntimeTestHost();
		const KiB = 1024;
		const results: Record<string, unknown> = {};
		let lastOk = 0;
		let firstFail = 0;
		for (const size of [64 * KiB, 512 * KiB, 1024 * KiB, 2048 * KiB, 4096 * KiB, 8192 * KiB, 16384 * KiB]) {
			const r = await route(host, "doc/put", { id: `d${size}`, bytes: size });
			results[`${size / KiB}KiB`] = r;
			if (r.ok && r.roundTrip) lastOk = size;
			else if (!firstFail) firstFail = size;
		}
		finding("S4.sizes", results);
		if (firstFail) {
			let lo = lastOk;
			let hi = firstFail;
			while (hi - lo > 64 * KiB) {
				const mid = Math.floor((lo + hi) / 2);
				const r = await route(host, "doc/put", { id: `b${mid}`, bytes: mid });
				if (r.ok && r.roundTrip) lo = mid;
				else hi = mid;
			}
			finding("S4.bisect", { largestOkBytes: lo, smallestFailBytes: hi });
		}
		// Measured: the local D1 (SQLite) accepts up to 4 MiB and rejects 8 MiB with SQLITE_TOOBIG on the serialised JSON.
		expect(lastOk).toBe(4096 * KiB);
		expect(firstFail).toBe(8192 * KiB);
	});
});

describe("S8 dynamic secrets", () => {
	it("encrypts a schema secret, stores a non-schema key as plaintext", async () => {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const body = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
		process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${body}`;
		host = await createPluginRuntimeTestHost();
		const viaAdmin = await host.actions.plugin.updateSettings({ apiKey: "sk-schema-secret" });
		finding("S8.updateSettings", viaAdmin);
		const schemaRaw = await host.inspect.settings.raw("apiKey");
		finding("S8.schemaRaw", schemaRaw);
		expect(JSON.stringify(schemaRaw)).toContain("ciphertext");
		expect(JSON.stringify(schemaRaw)).not.toContain("sk-schema-secret");

		// A schema key written from inside the sandbox with ctx.settings.set is encrypted as well.
		const viaSdk = await route(host, "setting/set", { key: "apiKey", value: "sk-sdk-secret" });
		const sdkRaw = await host.inspect.settings.raw("apiKey");
		finding("S8.schemaViaSdk", { got: viaSdk, raw: sdkRaw });
		expect(JSON.stringify(sdkRaw)).not.toContain("sk-sdk-secret");

		const set = await route(host, "setting/set", { key: "client:abc:secret", value: "dyn-plain-secret" });
		finding("S8.dynamicGet", set);
		const raw = await host.inspect.settings.raw("client:abc:secret");
		finding("S8.dynamicRaw", raw);
		// Measured: non-schema keys are NOT encrypted.
		expect(raw).toBe("dyn-plain-secret");
	});
});

describe("S9 content:beforeDelete veto", () => {
	const setup = async (mode: string) => {
		const h = await createPluginRuntimeTestHost();
		host = h;
		await h.fixtures.collection({
			slug: "posts",
			label: "Posts",
			fields: [{ slug: "title", label: "Title", type: "string" }],
		});
		const item = await h.fixtures.content("posts", { data: { title: "x" }, slug: "x" } as never);
		await route(h, "kv/set", { key: "deleteMode", value: mode });
		return { h, id: item.id };
	};

	it("return false blocks the delete (trash) action", async () => {
		const { h, id } = await setup("false");
		host = h;
		const trashed = await h.actions.content.trash("posts", id);
		finding("S9.false.trash", trashed);
		expect(trashed.success).toBe(false);
		expect((await h.inspect.content.get("posts", id))?.id).toBe(id);
		finding("S9.false.calls", await route(h, "kv/get", { key: "beforeDeleteCalls" }));
	});

	it("a permanent delete of an already trashed item never consults beforeDelete", async () => {
		const { h, id } = await setup("none");
		host = h;
		expect((await h.actions.content.trash("posts", id)).success).toBe(true);
		await route(h, "kv/set", { key: "deleteMode", value: "false" });
		const gone = await h.actions.content.delete("posts", id);
		finding("S9.false.permanentDelete", gone);
		finding("S9.beforeDeleteCalls", await route(h, "kv/get", { key: "beforeDeleteCalls" }));
		expect(gone.success).toBe(true);
		expect((await route(h, "kv/get", { key: "beforeDeleteCalls" })).value).toBe(1);
	});

	it("return { cancel: true, reason } does NOT block the delete (only === false does)", async () => {
		const { h, id } = await setup("cancel");
		host = h;
		const trashed = await h.actions.content.trash("posts", id);
		finding("S9.cancel.trash", trashed);
		expect(trashed.success).toBe(true);
	});

	it("returning undefined allows the delete", async () => {
		const { h, id } = await setup("none");
		host = h;
		const trashed = await h.actions.content.trash("posts", id);
		finding("S9.none.trash", trashed);
		expect(trashed.success).toBe(true);
		finding("S9.none.afterDelete", await route(h, "kv/get", { key: "afterDeleteCalls" }));
	});
});

describe("S7 registry plugin ids", () => {
	// Mirrors makeRegistryPluginId() in emdash (api handlers registry): r_ + base32(sha256(did + "\n" + slug))[0..16].
	const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	const derive = async (did: string, slug: string) => {
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${did}\n${slug}`)));
		let bits = 0;
		let value = 0;
		let out = "";
		for (const byte of digest) {
			value = (value << 8) | byte;
			bits += 8;
			while (bits >= 5) {
				bits -= 5;
				out += alphabet[(value >>> bits) & 31];
			}
		}
		return `r_${out.slice(0, 16)}`;
	};

	it("same slug from two publishers gets two different plugin ids", async () => {
		const a = await derive("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "events");
		const b = await derive("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", "events");
		finding("S7.ids", { a, b });
		expect(a).not.toBe(b);
		expect(a).not.toBe("events");
	});
});
