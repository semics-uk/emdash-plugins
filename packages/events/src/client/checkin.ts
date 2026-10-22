/**
 * The staff check-in screen's script (`/_events/check-in`, EV-FR-11, EV-FR-12, T082). It posts the
 * typed or scanned code to the core's private `checkin/code` route (Events Pro) with the staff
 * member's admin session (same-origin cookie and EmDash's `X-EmDash-Request` header), and shows the
 * answer as one large banner: checked in, already checked in, or refused with the reason; a pending
 * waiver gets the door signing link, and only a link to this site's `/_events/sign` is ever shown.
 * The camera scans QR passes with the browser's `BarcodeDetector` where there is one; elsewhere the
 * code field is the way in. Free has no such route: the screen says it needs Events Pro.
 *
 * Self-contained (no imports), no HTML sinks.
 */

export type Tone = "ok" | "warn" | "error";

export interface CheckInView {
	tone: Tone;
	title: string;
	message: string;
	/** WAIVER_PENDING: this site's door signing page for the attendee. */
	signLink?: string;
}

const MAX_CODE = 200;

/**
 * The screen's messages in the page's language, from the form's `data-messages` (the page renders them,
 * T102): keys without the `checkin.` prefix, plus `status.<booking status>`. A missing key shows the key.
 */
export type CheckInMessages = Record<string, string>;

const say = (m: CheckInMessages, key: string, vars: Record<string, string> = {}) =>
	(m[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);

/** A typed or scanned code, as the route takes it. */
export function codeFromScan(raw: string): string {
	return raw.trim().slice(0, MAX_CODE);
}

/** The link, when it is this site's door signing page; anything else is dropped. */
export function safeSignLink(link: unknown, origin: string): string | undefined {
	if (typeof link !== "string") return undefined;
	try {
		const url = new URL(link);
		return url.origin === origin && url.pathname === "/_events/sign" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

function timeOf(iso: unknown, lang: string | undefined): string {
	const at = typeof iso === "string" ? new Date(iso) : null;
	if (!at || Number.isNaN(at.getTime())) return "";
	try {
		return at.toLocaleTimeString(lang || [], { hour: "2-digit", minute: "2-digit" });
	} catch {
		return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
}

type Answer = {
	ok?: unknown;
	checkedIn?: unknown;
	reason?: unknown;
	name?: unknown;
	checkedInAt?: unknown;
	bookingStatus?: unknown;
	signLink?: unknown;
	error?: { code?: unknown };
};

/** What the screen shows for the route's HTTP status and (unwrapped or enveloped) answer. */
export function checkInView(
	status: number,
	raw: unknown,
	origin: string,
	m: CheckInMessages,
	lang?: string,
): CheckInView {
	const view = (tone: Tone, key: string, message = `${key}.message`, vars?: Record<string, string>): CheckInView => ({
		tone,
		title: say(m, `${key}.title`, vars),
		message: say(m, message, vars),
	});
	if (status === 401 || status === 403) return view("error", "notSignedIn");
	if (status === 404) return view("error", "unavailable");
	let body = raw as Answer | null;
	if (body && typeof body === "object" && "success" in body && "data" in body) {
		body = (body as { data: unknown }).data as Answer | null;
	}
	if (status < 200 || status > 299 || !body || typeof body !== "object") return view("error", "failed");
	const name = typeof body.name === "string" && body.name ? body.name : say(m, "attendee");
	if (body.ok !== true) {
		const code = String(body.error?.code ?? "");
		if (code.startsWith("LICENCE_")) return view("error", "licence");
		if (code === "BAD_REQUEST") return view("error", "enterCode");
		return view("error", "failed");
	}
	if (body.checkedIn === true) {
		const time = timeOf(body.checkedInAt, lang);
		return view("ok", "checkedIn", time ? "checkedIn.at" : "checkedIn.done", { name, time });
	}
	switch (body.reason) {
		case "ALREADY_CHECKED_IN": {
			const time = timeOf(body.checkedInAt, lang);
			return view("warn", "already", time ? "already.messageAt" : "already.message", { name, time });
		}
		case "NOT_FOUND":
			return view("error", "notFound");
		case "BOOKING_NOT_CONFIRMED": {
			const code = String(body.bookingStatus ?? "unknown");
			return view("error", "notConfirmed", undefined, { status: m[`status.${code}`] ?? code });
		}
		case "WAIVER_PENDING": {
			const signLink = safeSignLink(body.signLink, origin);
			return {
				...view("error", "waiver", signLink ? "waiver.messageLink" : "waiver.message", { name }),
				...(signLink ? { signLink } : {}),
			};
		}
		default:
			return view("error", "invalid");
	}
}

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorClass = {
	new (options: { formats: string[] }): Detector;
	getSupportedFormats?(): Promise<string[]>;
};

/** Wires the page's form, result region and camera button. */
export function startCheckIn(doc: Document = document): boolean {
	const form = doc.querySelector<HTMLFormElement>("form[data-semics-checkin]");
	const input = form?.querySelector<HTMLInputElement>('input[name="code"]');
	const out = doc.querySelector<HTMLElement>("[data-semics-checkin-result]");
	const api = form?.dataset.api;
	if (!form || !input || !out || !api) return false;
	const win = doc.defaultView as (Window & { BarcodeDetector?: DetectorClass }) | null;
	let m: CheckInMessages = {};
	try {
		m = JSON.parse(form.dataset.messages ?? "{}") as CheckInMessages;
	} catch {
		// No messages: the screen shows their keys.
	}
	const lang = doc.documentElement.lang || undefined;
	let busy = false;

	const show = (view: CheckInView) => {
		out.dataset.tone = view.tone;
		const title = doc.createElement("p");
		title.className = "semics-checkin-title";
		title.textContent = view.title;
		const message = doc.createElement("p");
		message.textContent = view.message;
		out.replaceChildren(title, message);
		if (view.signLink) {
			const link = doc.createElement("a");
			link.href = view.signLink;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.className = "semics-checkin-link";
			link.textContent = say(m, "signLink");
			out.append(link);
		}
		out.hidden = false;
	};

	const submit = async (raw: string) => {
		const code = codeFromScan(raw);
		if (busy) return;
		if (!code) {
			show({ tone: "error", title: say(m, "enterCode.title"), message: say(m, "enterCode.message") });
			return;
		}
		busy = true;
		const eventId = form.querySelector<HTMLSelectElement>('select[name="eventId"]')?.value ?? "";
		let status = 0;
		let body: unknown = null;
		try {
			const res = await fetch(api, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json", "X-EmDash-Request": "1" },
				body: JSON.stringify(eventId ? { code, eventId } : { code }),
			});
			status = res.status;
			body = await res.json().catch(() => null);
		} catch {
			// Offline or blocked: shown as "Something went wrong".
		}
		show(checkInView(status, body, doc.location.origin, m, lang));
		busy = false;
		input.value = "";
		input.focus();
	};

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void submit(input.value);
	});

	// The camera, where the browser can read QR codes itself.
	const button = doc.querySelector<HTMLButtonElement>("[data-semics-checkin-camera]");
	const video = doc.querySelector<HTMLVideoElement>("[data-semics-checkin-video]");
	const note = doc.querySelector<HTMLElement>("[data-semics-checkin-nocamera]");
	const Barcode = win?.BarcodeDetector;
	if (!button || !video || !Barcode || !win?.navigator.mediaDevices?.getUserMedia) {
		if (note) note.hidden = false;
		return true;
	}
	let stream: MediaStream | null = null;
	let last = "";
	let lastAt = 0;
	const stop = () => {
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = null;
		video.hidden = true;
		button.textContent = say(m, "camera");
	};
	const tick = async (detector: Detector) => {
		if (!stream) return;
		try {
			const [hit] = await detector.detect(video);
			const value = hit ? codeFromScan(hit.rawValue) : "";
			// The same pass held in front of the camera is read once every few seconds, not every frame.
			if (value && !busy && (value !== last || Date.now() - lastAt > 4000)) {
				last = value;
				lastAt = Date.now();
				await submit(value);
			}
		} catch {
			// A frame that is not ready yet.
		}
		win.setTimeout(() => void tick(detector), 250);
	};
	void Promise.resolve(Barcode.getSupportedFormats?.() ?? ["qr_code"]).then((formats) => {
		if (!formats.includes("qr_code")) {
			if (note) note.hidden = false;
			return;
		}
		button.hidden = false;
		button.addEventListener("click", async () => {
			if (stream) return stop();
			try {
				stream = await win.navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
			} catch {
				show({ tone: "error", title: say(m, "cameraFailed.title"), message: say(m, "cameraFailed.message") });
				return;
			}
			video.srcObject = stream;
			video.hidden = false;
			await video.play().catch(() => undefined);
			button.textContent = say(m, "stopCamera");
			void tick(new Barcode({ formats: ["qr_code"] }));
		});
	});
	return true;
}

if (typeof document !== "undefined") startCheckIn();
