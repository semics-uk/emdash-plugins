---
"@semics-tech/emdash-events": patch
---

The Events setup check moved from the admin to your site, at `/_events/setup`. Open it while signed in to the
admin as an administrator: it shows the field mapping and whether the collection and fields exist, whether saved
secrets can be decrypted with `EMDASH_ENCRYPTION_KEY`, and whether Turnstile is set up, with the same notices as
before. It shows no secret values; anyone else gets a "sign in as an administrator" message. The admin's **Events
setup** page now links to it and to the plugin settings. Moving it frees about 2.9 KB of the Events plugin's size
budget for future fixes.
