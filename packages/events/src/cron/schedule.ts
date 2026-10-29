/**
 * The schedule share of the `occurrences` tick (EV-FR-17, T129, R22): carries out one event's
 * `SlotPlan`. One `getMany` reads the slots the plan names; a slot to add that already exists (an
 * earlier write lost its catalog entry) is listed again from its document, never rewritten, so its
 * counters and overrides stay. A stale slot with seats held or sold stays as it is (booked slots are
 * never moved or deleted); an unbooked one leaves the catalog (`unlisted`), and a later tick deletes
 * it unless a checkout that planned from the old catalog landed on it meanwhile (then it is listed
 * again). Writes: `putMany` new slots, `deleteMany` dropped ones, and the config's catalog guarded on
 * `slotsRev` (a lost race is redone next tick). With the tick's cursor read and page query: <= 6 calls.
 */
import type { SlotPlan } from "../domain/schedule";
import { iso } from "../domain/time";
import type { ConfigStorage } from "../routes/config";
import type { CatalogOccurrence, EventConfigDoc, OccurrenceDoc } from "../storage/schema";

export const entryOf = (d: OccurrenceDoc): CatalogOccurrence => ({
	capacity: d.capacity,
	startsAt: d.startsAt,
	status: d.status,
});

const booked = (d: OccurrenceDoc | undefined) => !!d && (d.reserved > 0 || d.sold > 0);

export async function scheduleStep(
	storage: ConfigStorage,
	eventId: string,
	c: EventConfigDoc,
	plan: SlotPlan,
	now: number,
): Promise<void> {
	const s = c.schedule;
	const ids = [...plan.add.map((a) => a.id), ...plan.stale, ...plan.drop];
	const docs = (ids.length > 0 ? await storage.occurrences.getMany(ids) : new Map()) as Map<string, OccurrenceDoc>;
	const slots = { ...c.catalog?.occurrences };
	const fresh: Array<{ id: string; data: OccurrenceDoc }> = [];
	for (const { id, t } of plan.add) {
		let d = docs.get(id);
		if (!d && s) {
			d = {
				eventId,
				startsAt: iso(t),
				endsAt: iso(t + s.durationMinutes * 60_000),
				capacity: s.capacity,
				reserved: 0,
				sold: 0,
				status: "open",
			};
			fresh.push({ id, data: d });
		}
		if (d) slots[id] = entryOf(d);
	}
	const unlist = plan.stale.filter((id) => !booked(docs.get(id)));
	for (const id of [...unlist, ...plan.prune]) delete slots[id];
	const drop = plan.drop.filter((id) => {
		const d = docs.get(id);
		if (booked(d)) slots[id] = entryOf(d as OccurrenceDoc);
		return d && !booked(d);
	});
	if (fresh.length > 0) await storage.occurrences.putMany(fresh);
	if (drop.length > 0) await storage.occurrences.deleteMany(drop);
	await storage.event_configs.updateIf(eventId, {
		where: { slotsRev: c.slotsRev ?? null },
		set: {
			catalog: { ticketTypes: c.catalog?.ticketTypes ?? {}, occurrences: slots },
			unlisted: unlist.length > 0 ? { ids: unlist, at: now } : plan.ready ? null : (c.unlisted ?? null),
			kept: [...(c.kept ?? []), ...plan.stale.filter((id) => booked(docs.get(id)))].filter((id) => slots[id]),
		},
		delta: { slotsRev: { inc: 1 } },
	});
}
