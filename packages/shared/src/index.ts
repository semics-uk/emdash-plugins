/**
 * `@semics-tech/shared`: pure helpers shared by the plugin cores. Web APIs only, no Node built-ins,
 * no imports from a core or UI package. Consumed as TypeScript source; `emdash-plugin build`
 * inlines it into each core's sandbox bundle.
 */

/** Marker used to prove the package is bundled into a core's sandbox backend. */
export function sharedVersion(): string {
	return "shared-0";
}

export * from "./ics";
export * from "./money";
export * from "./result";
export * from "./time";
export * from "./tokens";

export * from "./blockkit";
