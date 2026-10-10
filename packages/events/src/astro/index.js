// Astro component exports for the Events UI. Auto-wired through componentsEntry.
import EventList from "./EventList.astro";

export const blockComponents = {
	"events-list": EventList,
};

export { EventList };
