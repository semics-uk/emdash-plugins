import { type APIRequestContext, type Browser, expect, test } from "@playwright/test";

import {
	address,
	adminHeaders,
	BOOKING_URL,
	book,
	EVENTS_API,
	eventIdFor,
	linkIn,
	mailTo,
	requirePro,
	target,
	visitor,
} from "./support";

// R57 (T083 follow-up) end to end on a Pro build: an update notice sent from the Pro "Email attendees"
// page reaches the buyer with a signed `/_events/opt-out` link, answered by Pro's real
// `public/mail/opt-out` route. Opening an emailed booking link replaces the token hash the link is
// signed with, so an older opt-out link stops working. Needs the emails, so it runs where the `/e2e`
// helper routes exist (STAGING_LOCAL=1); a deployed staging site has none.

test.skip(!target.helpers, "reads emails through the local /e2e helpers");

async function sendUpdate(request: APIRequestContext, subject: string) {
	const eventId = await eventIdFor(request, "london-meetup");
	const res = await request.post(`${EVENTS_API}/admin`, {
		headers: adminHeaders(),
		data: {
			type: "form_submit",
			action_id: "broadcasts.send",
			values: { target: eventId, kind: "update", subject, message: "Doors now open at 18:30." },
		},
	});
	expect(res.ok()).toBe(true);
	expect(JSON.stringify(await res.json())).toContain(`Sending \\"${subject}\\"`);
}

async function bookAndNotify(browser: Browser, request: APIRequestContext, who: string) {
	const email = address(who);
	const guest = await visitor(browser);
	await book(guest.page, "london-meetup", /General admission/, "Opt Out Tester", email);
	await guest.context.close();
	const subject = `New start time ${who} ${Date.now().toString(36)}`;
	await sendUpdate(request, subject);
	const update = await mailTo(request, email, new RegExp(subject));
	return { email, optOut: linkIn(update, "/_events/opt-out") };
}

test("Pro: the opt-out link in an update notice stops further emails to that address", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const { optOut } = await bookAndNotify(browser, request, "optout");
	const v = await visitor(browser);
	await v.page.goto(optOut);
	// Opening the link changes nothing; the button does.
	await expect(v.page.getByTestId("opt-out-form")).toBeVisible();
	await v.page.getByRole("button", { name: "Stop these emails" }).click();
	await expect(v.page.getByTestId("opt-out-done")).toBeVisible();
	await v.context.close();
});

test("Pro: an opt-out link stops working once the buyer redeems an emailed booking link", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const { email, optOut } = await bookAndNotify(browser, request, "redeemed");
	// The confirmation email's one-time booking link, redeemed in a fresh browser.
	const confirmation = await mailTo(request, email, /^Your booking: London Community Meetup$/);
	const reader = await visitor(browser);
	await reader.page.goto(linkIn(confirmation, "/booking"));
	await reader.page.getByRole("button", { name: "Open my booking" }).click();
	await expect(reader.page).toHaveURL(BOOKING_URL);
	await reader.context.close();

	const v = await visitor(browser);
	await v.page.goto(optOut);
	await v.page.getByRole("button", { name: "Stop these emails" }).click();
	await expect(v.page.getByTestId("opt-out-invalid")).toBeVisible();
	await v.context.close();
});
