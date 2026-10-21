// Astro component exports for the Events UI. Auto-wired through componentsEntry.
import AddToCalendar from "./AddToCalendar.astro";
import BookingStatus from "./BookingStatus.astro";
import BookingWidget from "./BookingWidget.astro";
import EventList from "./EventList.astro";
import TicketPass from "./TicketPass.astro";

export const blockComponents = {
	"events-list": EventList,
};

// The only way UI code calls the core (in-process public routes, fetch fallback).
export { callPublicRoute, EVENTS_PLUGIN_ID } from "./lib/call.ts";
export { AddToCalendar, BookingStatus, BookingWidget, EventList, TicketPass };
