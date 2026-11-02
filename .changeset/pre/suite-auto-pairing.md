---
"@semics-tech/emdash-events-suite": minor
---

New page `/_events/pair`: an administrator pairs Events with E-sign on the same site in one click. E-sign creates (or reuses) the site client and the pairing string goes straight into Events' encrypted `esignPairing` setting on the server; it is never shown or sent to the browser. Unpair revokes the client; a pairing left behind after E-sign is removed is cleared when the page is opened.
