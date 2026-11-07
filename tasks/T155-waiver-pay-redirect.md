---
id: T155
title: "Waiver page: signing a paid booking reaches the payment page"
phase: 7
package: events-suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T077]
spec: []
---

# T155 · Waiver page reaches the payment page

## Definition

From the Lea Marston staging test with Stripe in test mode: after the last signature of a paid booking the "Sign
document" button stayed disabled and the page never moved. The signature had saved. The post redirects to the payment
provider (T077), and the page's `form-action 'self'` covers where a post redirects, so the browser refuses to follow.

## Acceptance criteria

- [x] A test failed first: `leavesSite` tells a payment page from the booking page.
- [x] A redirect within the site is unchanged.
- [x] A redirect off the site answers with a page that goes there by meta refresh, with a link if that does nothing.
- [x] The CSP is unchanged: no provider's origin is added, so any payment provider works.

## Notes

- Adding the provider to `form-action` was rejected: the suite does not know the provider, and `isPayUrl` allows any
  https URL.
