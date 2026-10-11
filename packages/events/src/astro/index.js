// Astro component exports for the Events UI. Auto-wired through componentsEntry.
import EventList from "./EventList.astro";

export const blockComponents = {
	"events-list": EventList,
};

export { EventList };

// The only way UI code calls the core (in-process public routes, fetch fallback).
export { callPublicRoute, EVENTS_PLUGIN_ID } from "./lib/call.ts";
