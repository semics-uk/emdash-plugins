---
id: T176
title: "Booking-request windows that change by weekday, date range and season"
phase: 8
package: events, events-suite
edition: free
status: done
model: opus-5.5
size: M
depends_on: []
spec: []
---

# T176 Booking-request windows that change by weekday and season

Asked by the LMSC cutover session, 2026-11-18. Needed before about February 2027: bookings open 60 days ahead and the first summer Wednesday is 7 April 2027.

## Need

Today an event's `config.requests.windows` applies on every open day. LMSC has Morning 10:00–12:00 and Afternoon 12:00–15:30 every open day. From April until the clocks go back in October, Wednesdays are late opening and offer only 15:30–17:00 and 17:00–18:30.

## Shape

`config.requests.rules?: Array<{ days?: string[]; from?: "MM-DD"; to?: "MM-DD"; summer?: boolean; windows: Window[] }>`

- A rule matches a local date when all of its given conditions hold:
  - its weekday is in `days` (`MO`..`SU`);
  - it falls between `from` and `to`, inclusive (`from` after `to` wraps the year);
  - with `summer: true`, the event's timezone is on daylight-saving time that day. That covers "until the clocks go back", whatever year.
- The first rule that matches replaces `windows` for that date.
- A window id is unique across `windows` and all rules, since a booking stores only the id.
- At most 10 rules.

## Where it applies

- **Server:** `requestStart` / `planCheckout` refuse a window that isn't offered on the requested date (`REQUEST_WINDOW`).
- **Emails:** the label in confirmation and request emails, and anywhere else that looks up a window by id.
- **Hold and confirm times:** the admin's confirm-time defaults.
- **Booking widget and the suite's BookingWithWaiver:**
  - Without JavaScript: list every window, with the server refusing a wrong one, or group them by rule.
  - With JavaScript: show only the chosen date's windows.
  - `public/event` serves the rules.
- **Admin panel:** a "rules" text field. One rule per line, e.g. `WE 04-01..10-31 summer: 15:30-17:00 Late 1, 17:00-18:30 Late 2`.

## Constraints

- Free Events backend has 747 B left under budget and the budget must not be raised. Make room first if needed, e.g. move the T162 setup check page out.
- TDD, with tests in their own commit. e2e: an LMSC-shaped event where a summer Wednesday offers only the late windows and a winter Wednesday offers the normal ones.

## Notes (2026-11-18)

- **Shape as specified.** `parseRequests` validates `rules`: at most 10; only `days`, `from`, `to`, `summer`, `windows`;
  `days` 1–7 weekdays; `from` and `to` both or neither, real `MM-DD` days (29 Feb allowed); `summer` only `true`; 1–8
  windows each; window ids unique across `windows` and every rule. `rules` is stored only when non-empty.
- **Summer.** The zone's UTC offset at noon that day is above the lesser of its 1 Jan and 1 Jul offsets (the shared
  `utcOffsetMinutes`): works south of the equator, never true in a zone without daylight saving.
- **Server.** `windowsOn(config, date)` gives a date's windows; `requestStart` takes only those, and reserve refuses
  another with `REQUEST_WINDOW`. `windowOf(config, id)` finds a window across every rule (emails, the Bookings page's
  Confirm time default).
- **Widget and BookingWithWaiver.** Each date option carries `data-windows`; an inline script shows only those radios
  (and checks a lone one). Without JavaScript every window is listed once and the server refuses a wrong one.
- **Admin: no rules field (bytes).** Rules are set through `config/save` only; a panel save keeps the stored `rules`
  unchanged. Read the config with `config/get`, add `rules` to `requests`, and save it back. LMSC:

```json
"rules": [
  {
    "days": ["WE"],
    "from": "04-01",
    "to": "10-31",
    "summer": true,
    "windows": [
      { "id": "late-1", "label": "Late 1", "start": "15:30", "end": "17:00" },
      { "id": "late-2", "label": "Late 2", "start": "17:00", "end": "18:30" }
    ]
  }
]
```

- **Bytes.** Free backend 123,157 → 123,751 B (+594); 153 B left under budget less hotfix room. T176 itself is about
  +740 B; a panel rules field (`WE 04-01..10-31 summer: 15:30-17:00 Late 1, ...`) would add about 560 B more and did not
  fit. Made room with behaviour-neutral truthiness rewrites (`x.length > 0` to `x.length`, `x.length === 0` to
  `!x.length`) on arrays and strings in conditions only, about 150 B. Not moved: the T162 setup check page (still open
  for Oli).
