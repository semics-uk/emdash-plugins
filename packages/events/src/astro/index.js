// Astro component exports for the Events UI. Auto-wired through componentsEntry.
import AddToCalendar from "./AddToCalendar.astro";
import BookingBlock from "./BookingBlock.astro";
import BookingStatus from "./BookingStatus.astro";
import BookingWidget from "./BookingWidget.astro";
import EventCard from "./EventCard.astro";
import EventList from "./EventList.astro";
import TicketPass from "./TicketPass.astro";

export const blockComponents = {
	"events-booking": BookingBlock,
	"events-list": EventList,
};

// The only way UI code calls the core (in-process public routes, fetch fallback).
export { callPublicRoute, EVENTS_PLUGIN_ID } from "./lib/call.ts";
export { AddToCalendar, BookingBlock, BookingStatus, BookingWidget, EventCard, EventList, TicketPass };
