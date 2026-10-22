---
"@semics-tech/emdash-events": minor
"@semics-tech/emdash-esign": patch
---

Waitlist for sold-out events. With "Waitlist when sold out" on, the booking widget shows a "Join the waitlist" form once tickets (or a date) are sold out. When seats come free, the new `waitlist` cron task (every minute) holds them for the first person in line for 24 hours and emails a one-time claim link; claiming it on the booking page confirms a free booking (or goes to payment), and an unclaimed offer passes to the next person. Joining has a bot check and a per-connection limit. Waitlist entries are deleted by the retention job after the retention period and by the admin's "Delete personal data" (by email). The schedules flag moves to v9, so both cores schedule their recurring tasks once more.
