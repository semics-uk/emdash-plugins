/** Reply helpers the public routes share (one copy in the bundle, R42). */
import { type ErrorCode, toRouteError } from "@semics-tech/shared";

import type { InputIssue } from "../domain/checkout";

/** The error body for `code`. */
export const fail = (code: ErrorCode) => toRouteError(code).body;

/** `BAD_REQUEST` with the input issues. */
export const badRequest = (issues: InputIssue[]) => ({ ...fail("BAD_REQUEST"), issues });
