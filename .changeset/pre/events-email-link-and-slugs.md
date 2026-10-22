---
"@semics-tech/emdash-events": minor
---

The booking page handles the emailed `?ref=&k=` link: it shows an "Open my booking" button and only its POST redeems the one-time code (`public/booking/redeem`), sets the HttpOnly booking cookie and redirects without `k`, so mail scanners that prefetch links can't use it up. `public/events` rows carry the entry's `slug` and `<EventList>` links each card to `/events/<slug>` by default (`hrefFor` still overrides). The event info copy now reads EmDash's content item shape (`{ slug, data }`) in `content:afterSave`/`afterPublish`, which previously left it stale. `callPublicRoute` takes the visitor's `request` and passes on its client-IP headers (never cookies), so the per-IP checkout limit counts visitors instead of one shared unknown address.
