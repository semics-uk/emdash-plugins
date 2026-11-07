---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
"@semics-tech/emdash-events-suite": patch
---

Review follow-ups to the LMSC staging fixes. An approval stays inside the bridge call limit and its Bookings page survives a failed name read. A request the organiser never decided says so, and a hold past its deadline reads as lapsed. A queued admin notice is dropped only for an ended booking. A bad locale cannot break deadlines on `/booking`, and blocked storage cannot stop the date picker. A kept form skips dates that have gone, and is forgotten on the booking page and on Back. `theme.font` reaches the signing form (`--esign-font`), and `page.stylesheet` refuses `;` and `,`.
