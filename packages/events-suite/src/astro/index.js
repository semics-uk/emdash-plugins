// Astro entry of the suite. `<BookingWithWaiver event={entryId} />` goes on any page of the site; its
// signing step runs on `/_events/waiver`, which `eventsSuite()` injects.
import BookingWithWaiver from "./BookingWithWaiver.astro";

export { BookingWithWaiver };
