/** An epoch-ms instant as an ISO 8601 UTC string (the form every stored timestamp uses). */
export const iso = (ms: number): string => new Date(ms).toISOString();

/** A stored timestamp as epoch ms; NaN when absent or unparsable (`Date.parse`, R100: one copy). */
export const msOf = (text: string | null | undefined): number => Date.parse(text ?? "");
