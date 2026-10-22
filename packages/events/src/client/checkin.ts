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
const ADMIN_HINT = "Use the Attendees page in the admin instead.";

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

function timeOf(iso: unknown): string {
	const at = typeof iso === "string" ? new Date(iso) : null;
	return at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
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
export function checkInView(status: number, raw: unknown, origin: string): CheckInView {
	if (status === 401 || status === 403) {
		return { tone: "error", title: "Not signed in", message: "Sign in to the admin on this device, then try again." };
	}
	if (status === 404) {
		return {
			tone: "error",
			title: "Check-in screen not available",
			message: `The check-in screen needs Events Pro. ${ADMIN_HINT}`,
		};
	}
	let body = raw as Answer | null;
	if (body && typeof body === "object" && "success" in body && "data" in body) {
		body = (body as { data: unknown }).data as Answer | null;
	}
	if (status < 200 || status > 299 || !body || typeof body !== "object") {
		return {
			tone: "error",
			title: "Something went wrong",
			message: `The code was not checked. Try again. ${ADMIN_HINT}`,
		};
	}
	const name = typeof body.name === "string" && body.name ? body.name : "This attendee";
	if (body.ok !== true) {
		const code = String(body.error?.code ?? "");
		if (code.startsWith("LICENCE_")) {
			return {
				tone: "error",
				title: "Events Pro licence needed",
				message: `This site's Events Pro licence is not valid, so the check-in screen is off. ${ADMIN_HINT}`,
			};
		}
		if (code === "BAD_REQUEST")
			return { tone: "error", title: "Enter a code", message: "Type or scan a check-in code." };
		return {
			tone: "error",
			title: "Something went wrong",
			message: `The code was not checked. Try again. ${ADMIN_HINT}`,
		};
	}
	if (body.checkedIn === true) {
		const at = timeOf(body.checkedInAt);
		return { tone: "ok", title: `Checked in: ${name}`, message: at ? `At ${at}.` : "Done." };
	}
	switch (body.reason) {
		case "ALREADY_CHECKED_IN": {
			const at = timeOf(body.checkedInAt);
			return {
				tone: "warn",
				title: "Already checked in",
				message: `${name} was first checked in${at ? ` at ${at}` : ""}. Do not let the ticket in twice.`,
			};
		}
		case "NOT_FOUND":
			return {
				tone: "error",
				title: "Code not found",
				message: "No attendee has that code for this event. Check the event, or type the code from the ticket.",
			};
		case "BOOKING_NOT_CONFIRMED":
			return {
				tone: "error",
				title: "Cannot check in",
				message: `The booking is not confirmed (it is ${String(body.bookingStatus ?? "unknown")}), so this ticket is not valid.`,
			};
		case "WAIVER_PENDING": {
			const signLink = safeSignLink(body.signLink, origin);
			return {
				tone: "error",
				title: "Waiver not signed",
				message: signLink
					? `${name} has not signed the waiver yet. Open the signing page so they can sign on this device, then check them in again.`
					: `${name} has not signed the waiver yet. Check them in once they have signed.`,
				...(signLink ? { signLink } : {}),
			};
		}
		default:
			return { tone: "error", title: "Cannot check in", message: "This ticket is not valid." };
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
			link.textContent = "Open the signing page";
			out.append(link);
		}
		out.hidden = false;
	};

	const submit = async (raw: string) => {
		const code = codeFromScan(raw);
		if (busy) return;
		if (!code) {
			show({ tone: "error", title: "Enter a code", message: "Type or scan a check-in code." });
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
		show(checkInView(status, body, doc.location.origin));
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
		button.textContent = "Scan with camera";
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
				show({ tone: "error", title: "Camera not available", message: "Allow the camera, or type the code instead." });
				return;
			}
			video.srcObject = stream;
			video.hidden = false;
			await video.play().catch(() => undefined);
			button.textContent = "Stop camera";
			void tick(new Barcode({ formats: ["qr_code"] }));
		});
	});
	return true;
}

if (typeof document !== "undefined") startCheckIn();
