// Astro entry of the suite. `<BookingWithWaiver event={entryId} />` goes on any page of the site; its
// signing step runs on `/_events/waiver`, which `eventsSuite()` injects.
// T168: `<BuyVoucher />` (with `eventsSuite({ vouchers })`) sells gift vouchers through `/_vouchers/buy`.
import BookingWithWaiver from "./BookingWithWaiver.astro";
import BuyVoucher from "./BuyVoucher.astro";

export { BookingWithWaiver, BuyVoucher };
