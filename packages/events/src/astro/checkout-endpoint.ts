// Injected at `/_events/checkout` by the integration. A plain form post (no JavaScript needed).
import { pluginId } from "virtual:semics-events/config";

import { BOOKING_PATH, handleCheckoutForm } from "./lib/checkout-form";

interface EndpointContext {
	request: Request;
	url: URL;
	locals: never;
	redirect(location: string, status?: number): Response;
	cookies: {
		set(name: string, value: string, options: Record<string, unknown>): void;
	};
}

export const prerender = false;

export async function POST({ request, url, locals, redirect, cookies }: EndpointContext): Promise<Response> {
	const form = await request.formData().catch(() => new FormData());
	const result = await handleCheckoutForm({ locals, url }, form, { pluginId });
	if (result.cookie) {
		cookies.set(result.cookie.name, result.cookie.value, {
			path: BOOKING_PATH,
			httpOnly: true,
			sameSite: "lax",
			secure: url.protocol === "https:",
			maxAge: 60 * 60 * 24 * 30,
		});
	}
	return redirect(result.location, 303);
}
