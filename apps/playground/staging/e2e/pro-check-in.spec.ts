import { expect, test } from "@playwright/test";

import { address, adminHeaders, book, requirePro, visitor } from "./support";

// R54 (T082 follow-up) end to end on a Pro build: the pass draws the QR the Pro core encoded, and the
// Free check-in screen checks the ticket in through Pro's real private `checkin/code` route, no mocks.

test("Pro: a booked ticket's code checks in once at the door, the second scan is refused", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const guest = await visitor(browser);
	await book(guest.page, "london-meetup", /General admission/, "Katherine Johnson", address("checkin"));
	const code = (await guest.page.getByTestId("ticket-code").first().textContent())?.trim() ?? "";
	expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
	// The Pro core adds the QR matrix to public/booking; the Free pass draws it.
	await expect(guest.page.getByTestId("ticket-qr").first()).toBeVisible();
	await guest.context.close();

	// Door staff: signed in (the admin token stands in for the session), on a phone.
	const staff = await browser.newContext({ extraHTTPHeaders: adminHeaders(), viewport: { width: 320, height: 640 } });
	const door = await staff.newPage();
	await door.goto("/_events/check-in");
	const enter = async () => {
		await door.getByLabel("Check-in code").fill(code);
		await door.getByRole("button", { name: "Check in" }).click();
	};
	await enter();
	const result = door.getByTestId("checkin-result");
	await expect(result).toHaveAttribute("data-tone", "ok");
	await expect(result).toContainText("Checked in: Katherine Johnson");
	await enter();
	await expect(result).toHaveAttribute("data-tone", "error");
	await expect(result).toContainText("Already checked in");
	await staff.close();
});
