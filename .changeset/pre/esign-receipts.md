---
"@semics-tech/emdash-esign": patch
---

Signed receipts for integrations (protocol §5.2, §8.2-§8.5). When the signer signs or declines an envelope an integration created, `/sign/[token]` sends the browser back to the intent's return URL with the receipt in the URL fragment (`#receipt=`), never a query string. `public/receipts/lookup` answers a client-signed lookup with `none`, `pending` or the terminal receipt (with `pdfSha256` once the signed PDF is stored). `public/templates/catalog` lists the templates marked "available to integrations". Decline and void now record `closedAt`, the receipt's `at`.
