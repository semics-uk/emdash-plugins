---
"@semics-tech/emdash-events-suite": minor
---

A paid waiver booking goes to the payment page after the last signature (the waiver page asks Events to continue the booking again and follows the `pay` step). The booking cookie now also reaches `/_events/waiver` through a path-scoped copy, which the retry button needed in real browsers.
