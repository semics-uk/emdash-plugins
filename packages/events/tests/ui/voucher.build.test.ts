import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { translator } from "../../src/i18n/index";
import { eventsIntegration } from "../../src/integration/index";
import { callPublicRoute } from "../../src/astro/lib/call";
import { ERROR_MESSAGES, fieldMessage, readWidgetState, reconcileWanted } from "../../src/astro/lib/widget";

const { t } = translator("en");

// T166 (T163 §6, R16): gift vouchers in the booking widget, the booking page and the integration. Events Pro
// answers `vouchers: true` on `public/event` only once it is paired with Vouchers; Free never does.
const source = (file: string) => readFileSync(fileURLToPath(new URL(`../../src/astro/${file}`, import.meta.url)), "utf8");

describe("T166 R16 the widget's Gift voucher code field", () => {
	it("R16 shows the field only when public/event says the core takes vouchers, inside the order form", () => {
		const widget = source("BookingWidget.astro");
		expect(widget).toContain("const takesVouchers = data?.vouchers === true;");
		expect(widget).toMatch(/\{takesVouchers && \(/);
		expect(widget).toContain('name="voucherCode"');
		expect(t("widget.voucher.label")).toBe("Gift voucher code");
	});

	it("R16 a refusal names the voucher field with its own message, and every VOUCHER_* code has one", () => {
		const url = new URL("https://site.example/e?booking_error=VOUCHER_NO_BALANCE&booking_fields=voucher&booking_event=ev1");
		expect(readWidgetState(url, "ev1")).toEqual({ code: "VOUCHER_NO_BALANCE", fields: ["voucher"] });
		for (const code of [
			"VOUCHER_INVALID",
			"VOUCHER_NO_BALANCE",
			"VOUCHER_WRONG_ACTIVITY",
			"VOUCHER_CURRENCY",
			"VOUCHER_UNAVAILABLE",
		]) {
			expect(ERROR_MESSAGES[code], code).toBeTruthy();
		}
		expect(fieldMessage("voucher", "en")).toBe("Check the code, or leave it empty.");
	});
});

describe("T166 R16 the booking page", () => {
	it("R16 shows a Gift voucher line when the totals carry one", () => {
		const status = source("BookingStatus.astro");
		expect(status).toContain("booking.totals.voucherMinor");
		expect(status).toContain('t("booking.voucher")');
		expect(t("booking.voucher")).toBe("Gift voucher");
	});

	it("R16 settles the voucher through the suite's reconcile when Pro answers a settle token", () => {
		expect(reconcileWanted({ voucher: { settle: "a.b" } } as never)).toBe(true);
		expect(reconcileWanted({ voucher: { settle: null } } as never)).toBe(false);
		expect(source("BookingPage.astro")).toContain("vouchersPluginId");
	});
});

describe("T166 R16 eventsIntegration({ vouchers })", () => {
	async function load(options?: Parameters<typeof eventsIntegration>[0]) {
		let source = "";
		await eventsIntegration(options).hooks["astro:config:setup"]?.({
			injectRoute: () => undefined,
			updateConfig: (c: { vite: { plugins: Array<{ resolveId(id: string): string; load(id: string): string }> } }) => {
				const p = c.vite.plugins[0];
				source = p?.load(p.resolveId("virtual:semics-events/config")) ?? "";
			},
		} as never);
		return source;
	}

	it("R16 adds nothing to the site's config without vouchers (existing sites see no change)", async () => {
		expect(await load()).not.toContain("voucher");
	});

	it("R16 exports the Vouchers plugin id and the suite's hold hook when configured", async () => {
		const out = await load({ vouchers: { pluginId: "semics-vouchers", module: "suite/voucher" } });
		expect(out).toContain('export const vouchersPluginId = "semics-vouchers";');
		expect(out).toContain('export { holdVoucher } from "suite/voucher";');
	});
});

describe("T166 callPublicRoute keeps a refusal's extra fields", () => {
	it("R16 a VOUCHER_NO_BALANCE refusal's lookups reach the caller as details", async () => {
		const handler = async () => ({
			success: true,
			data: { ok: false, error: { code: "VOUCHER_NO_BALANCE", message: "No" }, lookups: ["a.b"] },
		});
		const result = await callPublicRoute(
			{ locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url: new URL("https://s.example/") },
			{ method: "POST", path: "public/redeem/hold", pluginId: "semics-vouchers", body: {} },
		);
		expect(result).toMatchObject({ ok: false, error: { code: "VOUCHER_NO_BALANCE", details: { lookups: ["a.b"] } } });
	});
});
