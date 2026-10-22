/**
 * Custom attendee questions in the booking widget (EV-FR-15, EU-FR-10, T080). Questions are Events
 * Pro's: `public/event` lists them only on a Pro core, and Pro's reserve checks the answers (required
 * ones, offered choices) and stores them on the booking. This module turns the listed questions into
 * the widget's controls and reads the answers back from the posted form. Pure.
 *
 * The buyer answers once per booking. Each control is named `answer:<id>`; the form also carries a
 * `questions` marker so the order sends `answers` (even `{}`) only when questions were shown: Free's
 * reserve refuses unknown keys.
 */
import { type PublicQuestion, QUESTION_ID, type QuestionField, type WidgetField } from "./widget";

export const ANSWER_PREFIX = "answer:";
export const QUESTIONS_MARKER = "questions";
/** The longest text answer (Pro's reserve refuses longer ones). */
export const MAX_ANSWER = 500;

export const QUESTION_MESSAGES: Record<PublicQuestion["type"], string> = {
	text: "Answer this question.",
	select: "Choose an answer.",
	checkbox: "Tick this box to continue.",
};

export interface QuestionControl {
	kind: PublicQuestion["type"];
	/** The question's id. */
	question: string;
	/** The control's HTML id, unique on the page. */
	id: string;
	name: string;
	field: QuestionField;
	label: string;
	required: boolean;
	/** Shown after the label of an optional question. */
	hint: "(optional)" | undefined;
	errorId: string;
	/** What the error says when the question needs an answer. */
	message: string;
	invalid: boolean;
	/** A choice question's options, after an empty prompt. */
	options?: Array<{ value: string; label: string }>;
	maxLength?: number;
}

const KINDS = new Set<string>(["text", "select", "checkbox"]);

function wellFormed(q: PublicQuestion): boolean {
	if (!q || typeof q !== "object" || typeof q.id !== "string" || !QUESTION_ID.test(q.id)) return false;
	if (typeof q.label !== "string" || q.label.trim() === "" || !KINDS.has(q.type)) return false;
	return q.type !== "select" || (Array.isArray(q.options) && q.options.some((o) => typeof o === "string" && o !== ""));
}

/** The widget's controls for `questions`, in order; `bad` are the fields a refusal named. */
export function questionControls(
	questions: readonly PublicQuestion[] | undefined,
	anchor: string,
	bad: readonly WidgetField[] | readonly string[],
): QuestionControl[] {
	return (questions ?? []).filter(wellFormed).map((q) => {
		const id = `${anchor}-q-${q.id}`;
		const field: QuestionField = `q:${q.id}`;
		const required = q.required === true;
		return {
			kind: q.type,
			question: q.id,
			id,
			name: `${ANSWER_PREFIX}${q.id}`,
			field,
			label: q.label.trim(),
			required,
			hint: required ? undefined : "(optional)",
			errorId: `${id}-error`,
			message: QUESTION_MESSAGES[q.type],
			invalid: (bad as readonly string[]).includes(field),
			...(q.type === "select"
				? {
						options: [
							{ value: "", label: "Choose an answer" },
							...(q.options ?? [])
								.filter((o) => typeof o === "string" && o !== "")
								.map((o) => ({ value: o, label: o })),
						],
					}
				: {}),
			...(q.type === "text" ? { maxLength: MAX_ANSWER } : {}),
		};
	});
}

/**
 * The answers in a posted widget form, keyed by question id (text trimmed; a ticked box posts `yes`), or
 * `undefined` when the widget showed no questions.
 */
export function answersFromForm(form: FormData): Record<string, string> | undefined {
	if (form.get(QUESTIONS_MARKER) === null) return undefined;
	const answers: Record<string, string> = {};
	for (const [key, value] of form.entries()) {
		if (!key.startsWith(ANSWER_PREFIX) || typeof value !== "string") continue;
		const id = key.slice(ANSWER_PREFIX.length);
		if (!QUESTION_ID.test(id)) continue;
		answers[id] = value.trim();
	}
	return answers;
}
