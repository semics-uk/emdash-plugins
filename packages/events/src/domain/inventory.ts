/** Inventory reservation engine (T044): stub for the red step. */
import type { Result } from "@semics-tech/shared";

import type { BookingDoc } from "../storage/schema";

export type CountedCollection = "ticket_types" | "occurrences" | "event_configs";
export interface CounterRef {
	collection: CountedCollection;
	id: string;
	qty: number;
}
export interface ReserveStep extends CounterRef {
	capacity: number;
}
export interface Counter {
	capacity: number;
	reserved: number;
}
export interface UpdateIfArgsLike {
	where: Record<string, unknown>;
	set?: Record<string, unknown>;
	delta?: Record<string, { inc: number } | { dec: number }>;
}
export interface CounterCollection {
	updateIf(id: string, args: UpdateIfArgsLike): Promise<{ applied: boolean }>;
}
export type CounterStorage = Record<CountedCollection, CounterCollection>;
export interface ReservationRequest {
	eventId: string;
	event: Counter;
	occurrenceId?: string;
	occurrence?: Counter;
	ticketTypes: ReadonlyMap<string, Counter>;
	lines: ReadonlyArray<{ ticketTypeId: unknown; qty: unknown }>;
}
export type SoldOut = { code: "SOLD_OUT"; collection: CountedCollection; id: string };
export type PlanError = { code: "BAD_REQUEST"; reason: string } | SoldOut;
export type ReserveError = (SoldOut | { code: "INTERNAL"; cause: unknown }) & { uncompensated: CounterRef[] };
export type BookingLike = Pick<BookingDoc, "eventId" | "occurrenceId" | "lines" | "status" | "createdAt">;
export interface CounterSnapshot {
	collection: CountedCollection;
	id: string;
	reserved: number;
	sold: number;
}
export interface DriftFix {
	collection: CountedCollection;
	id: string;
	from: { reserved: number; sold: number };
	to: { reserved: number; sold: number };
}
export type InventoryStorage = Record<string, any>;

export const DRAFT_GRACE_MS = 5 * 60_000;
const todo = (): never => {
	throw new Error("not implemented");
};
export function worstCaseCalls(_steps: number): number {
	return todo();
}
export function planReservation(_r: ReservationRequest, _o?: { maxCalls?: number }): Result<ReserveStep[], PlanError> {
	return todo();
}
export async function reserve(_s: CounterStorage, _steps: ReserveStep[]): Promise<Result<ReserveStep[], ReserveError>> {
	return todo();
}
export async function release(_s: CounterStorage, _r: CounterRef[], _o?: { sold?: boolean }): Promise<CounterRef[]> {
	return todo();
}
export async function confirmSold(_s: CounterStorage, _r: CounterRef[]): Promise<CounterRef[]> {
	return todo();
}
export function countersForBooking(_b: Pick<BookingDoc, "eventId" | "occurrenceId" | "lines">): CounterRef[] {
	return todo();
}
export function tallyBookings(_b: Iterable<BookingLike>, _now: number): Map<string, { reserved: number; sold: number }> {
	return todo();
}
export function planDriftRepair(_s: CounterSnapshot[], _t: Map<string, { reserved: number; sold: number }>): DriftFix[] {
	return todo();
}
export async function applyDriftRepair(
	_s: CounterStorage,
	_f: DriftFix[],
): Promise<{ repaired: DriftFix[]; conflicted: DriftFix[] }> {
	return todo();
}
export async function repairEventCounters(
	_s: InventoryStorage,
	_e: string,
	_now: number,
	_o?: { maxCalls?: number },
): Promise<{ complete: boolean; repaired: DriftFix[]; conflicted: DriftFix[]; pending: DriftFix[] }> {
	return todo();
}
export async function updateCountedFields(
	_c: CounterCollection,
	_id: string,
	_stored: object,
	_next: object,
): Promise<"unchanged" | "applied" | "conflict"> {
	return todo();
}
export async function retireCounted(_c: CounterCollection, _id: string): Promise<boolean> {
	return todo();
}
