/** An epoch-ms instant as an ISO 8601 UTC string (the form every stored timestamp uses). */
export const iso = (ms: number): string => new Date(ms).toISOString();
