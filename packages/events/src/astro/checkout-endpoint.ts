// Injected at `/_events/checkout` by the integration. A plain form post (no JavaScript needed).
import { pluginId } from "virtual:semics-events/config";

import { bookingCookieOptions, handleCheckoutForm } from "./lib/checkout-form";

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
	const result = await handleCheckoutForm({ locals, url, request }, form, { pluginId });
	if (result.cookie) cookies.set(result.cookie.name, result.cookie.value, bookingCookieOptions(url));
	return redirect(result.location, 303);
}
