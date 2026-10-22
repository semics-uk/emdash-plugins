/**
 * Custom attendee questions in the booking widget (EV-FR-15, EU-FR-10, T080; questions are Events
 * Pro's). The widget renders the questions `public/event` lists (Pro adds them) as labelled controls,
 * sends the answers with the order as `answers` (only when it showed questions: Free's reserve
 * refuses unknown keys), and maps Pro's `answers.<id>` refusals back to the question's field.
 */
import { describe, expect, it } from "vitest";

import { handleCheckoutForm } from "../../src/astro/lib/checkout-form";
import { ANSWER_PREFIX, answersFromForm, QUESTIONS_MARKER, questionControls } from "../../src/astro/lib/questions";
import { anchorId, fieldsFromIssues, readWidgetState, widgetErrorLocation } from "../../src/astro/lib/widget";
import { missingAnswers } from "../../src/client/booking";

const url = new URL("https://site.example/_events/checkout");
const KEY = "k".repeat(40);

const QUESTIONS = [
	{ id: "qdiet", label: "Dietary needs", type: "text" as const, required: false },
	{ id: "qsize", label: "T-shirt size", type: "select" as const, required: true, options: ["S", "M", "L"] },
	{ id: "qterms", label: "I accept the code of conduct", type: "checkbox" as const, required: true },
];

function host(answers: Record<string, unknown>) {
	const seen: Array<{ path: string; body: unknown }> = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({ path, body: method === "POST" ? await request.clone().json() : undefined });
		return answers[path] ?? { success: false, error: { code: "NOT_FOUND", message: "no route" } };
	};
	return { seen, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

const order = {
	eventId: "ev1",
	"qty:general": "1",
	name: "Ada",
	email: "ada@example.com",
	idempotencyKey: KEY,
	returnTo: "/events/spring",
};
const reserved = { success: true, data: { ok: true, bookingRef: "ABCDEFGHJK", accessToken: "T".repeat(43) } };
const confirmed = { success: true, data: { ok: true, status: "confirmed" } };

describe("EU-FR-10 the widget renders each question type accessibly", () => {
	const anchor = anchorId("ev1");

	it("EU-FR-10 every control has its own id, a label for it, a name and an error it is described by", () => {
		const controls = questionControls(QUESTIONS, anchor, []);
		expect(controls.map((c) => c.kind)).toEqual(["text", "select", "checkbox"]);
		const ids = new Set(controls.map((c) => c.id));
		expect(ids.size).toBe(3);
		for (const c of controls) {
			expect(c.id).toMatch(/^semics-booking-ev1-q-q[a-z]+$/);
			expect(c.name).toBe(`${ANSWER_PREFIX}${c.question}`);
			expect(c.errorId).toBe(`${c.id}-error`);
			expect(c.field).toBe(`q:${c.question}`);
			expect(c.invalid).toBe(false);
			expect(c.label.length).toBeGreaterThan(0);
		}
	});

	it("EU-FR-10 required questions are required controls; optional ones say so in their label", () => {
		const [diet, size, terms] = questionControls(QUESTIONS, anchor, []);
		expect(diet).toMatchObject({ required: false, hint: "(optional)", maxLength: 500 });
		expect(size).toMatchObject({ required: true, hint: undefined });
		expect(terms).toMatchObject({ required: true, hint: undefined });
	});

	it("EU-FR-10 a choice question offers an empty prompt first and then each option as given", () => {
		const size = questionControls(QUESTIONS, anchor, [])[1];
		expect(size?.options).toEqual([
			{ value: "", label: "Choose an answer" },
			{ value: "S", label: "S" },
			{ value: "M", label: "M" },
			{ value: "L", label: "L" },
		]);
	});

	it("EU-FR-10 a field the server refused is invalid and shows its type's message", () => {
		const controls = questionControls(QUESTIONS, anchor, ["q:qsize", "q:qterms", "name"]);
		expect(controls.map((c) => c.invalid)).toEqual([false, true, true]);
		expect(controls[1]?.message).toBe("Choose an answer.");
		expect(controls[2]?.message).toBe("Tick this box to continue.");
		expect(controls[0]?.message).toBe("Answer this question.");
	});

	it("EU-FR-10 nothing is rendered for an event without questions, and malformed entries are skipped", () => {
		expect(questionControls(undefined, anchor, [])).toEqual([]);
		const odd = [
			{ id: "bad id!", label: "x", type: "text", required: false },
			{ id: "qok", label: "", type: "text", required: false },
			{ id: "qtype", label: "Odd", type: "radio", required: false },
			{ id: "qnone", label: "No options", type: "select", required: false, options: [] },
		];
		expect(questionControls(odd as never, anchor, [])).toEqual([]);
	});
});

describe("EV-FR-15 answers travel with the order", () => {
	it("EV-FR-15 collects answer fields (a ticked box is yes) only when the widget showed questions", () => {
		const shown = form({
			[QUESTIONS_MARKER]: "1",
			[`${ANSWER_PREFIX}qdiet`]: "  vegan ",
			[`${ANSWER_PREFIX}qsize`]: "M",
			[`${ANSWER_PREFIX}qterms`]: "on",
		});
		expect(answersFromForm(shown)).toEqual({ qdiet: "vegan", qsize: "M", qterms: "yes" });
		expect(answersFromForm(form({ [QUESTIONS_MARKER]: "1" }))).toEqual({});
		expect(answersFromForm(form({ [`${ANSWER_PREFIX}qdiet`]: "x" }))).toBeUndefined();
	});

	it("EV-FR-15 sends answers to reserve with the order, and no answers key for an event without questions", async () => {
		const h = host({ "public/checkout/reserve": reserved, "public/checkout/continue": confirmed });
		await handleCheckoutForm(
			{ locals: h.locals, url },
			form({ ...order, [QUESTIONS_MARKER]: "1", [`${ANSWER_PREFIX}qsize`]: "L" }),
			{},
		);
		expect(h.seen[0]?.body).toMatchObject({ answers: { qsize: "L" } });
		const plain = host({ "public/checkout/reserve": reserved, "public/checkout/continue": confirmed });
		await handleCheckoutForm({ locals: plain.locals, url }, form(order), {});
		expect(Object.keys(plain.seen[0]?.body as object)).not.toContain("answers");
	});

	it("EV-FR-15 a refused answer goes back to the widget on that question's field, the answer never in the URL", async () => {
		const refused = {
			success: true,
			data: {
				ok: false,
				error: { code: "BAD_REQUEST", message: "Invalid input" },
				issues: [
					{ path: "answers.qsize", code: "required" },
					{ path: "answers.qterms", code: "required" },
				],
			},
		};
		const h = host({ "public/checkout/reserve": refused });
		const out = await handleCheckoutForm(
			{ locals: h.locals, url },
			form({ ...order, [QUESTIONS_MARKER]: "1", [`${ANSWER_PREFIX}qdiet`]: "SECRET-DIET" }),
			{},
		);
		const loc = new URL(out.location, url);
		expect(loc.pathname).toBe("/events/spring");
		expect(loc.searchParams.get("booking_error")).toBe("BAD_REQUEST");
		expect(out.location).not.toContain("SECRET");
		expect(readWidgetState(loc, "ev1")).toEqual({ code: "BAD_REQUEST", fields: ["q:qsize", "q:qterms"] });
	});

	it("EV-FR-15 maps answers issues to question fields, and drops question fields with unsafe ids", () => {
		expect(fieldsFromIssues([{ path: "answers.qa", code: "required" }, { path: "buyer.name" }])).toEqual([
			"q:qa",
			"name",
		]);
		const loc = new URL(widgetErrorLocation("/e", "ev1", "BAD_REQUEST", ["name", "q:ok-1", "q:<b>" as never]), url);
		expect(readWidgetState(loc, "ev1").fields).toEqual(["name", "q:ok-1"]);
	});

	it("EV-FR-15 the client script finds unanswered required questions before anything is sent", () => {
		expect(
			missingAnswers([
				{ field: "q:qdiet", required: false, filled: false },
				{ field: "q:qsize", required: true, filled: false },
				{ field: "q:qterms", required: true, filled: true },
			]),
		).toEqual(["q:qsize"]);
	});
});
