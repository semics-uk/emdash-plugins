export const RETENTION_TASK = "retention";
export const RETENTION_MORE_TASK = "retention-more";
export const RETENTION_STATE_KEY = "cron:retention";
export const RETENTION_PAGE = 10;
export interface RetentionState {
	phase?: "personal" | "records" | "outbox";
}
