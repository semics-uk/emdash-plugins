---
"@semics-tech/emdash-events": minor
---

Add seat holds: 15-minute free and 35-minute paid holds, step extensions capped at the 60-minute ceiling, and the `sweep-holds` cron (scheduled every 5 minutes on activation) that expires lapsed holds in budgeted batches and repairs counter drift with a cursor kept in KV. One-shot `hold-<ref>` tasks expire a booking on time and only accelerate the sweeper.
