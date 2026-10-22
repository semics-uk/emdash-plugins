# Translations

The Events and E-sign UI kits (components, the pages they add, and their scripts) show no text of their own.
Every word comes from a translation table. They ship with **English** and **Arabic**, the first
right-to-left language. To add a language, follow [Adding a language](../../../docs/i18n.md).

## Choosing the language

A component uses, in order: its `locale` prop, then the page's locale when your site configures
[Astro i18n](https://docs.astro.build/en/guides/internationalization/), then British English. The pages the
plugins add use only the page locale. A site that is wholly in one language can set Astro's
`i18n: { defaultLocale: "ar", locales: ["ar"] }`.

The locale also formats dates, times, numbers and prices. A language without a table (French, say) shows
English text with French formats.

## What stays in English

The sandboxed cores answer with codes, and only the UI kits turn codes into words. That keeps the cores
small. So some text is English in this release, whatever the page's language:

- emails, calendar files and the Block Kit admin pages (all made by the cores) stay in English;
- the suite's own pages, `<BookingWithWaiver>`, `/_events/waiver` and `/_events/templates`, are not
  translated yet and stay in English.

## Your own words

Text you write is yours to translate: event titles, venues, ticket names, questions, templates, and the
E-sign consent wording (an E-sign setting).
