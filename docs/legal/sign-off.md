# Legal sign-off: what we need from a solicitor

> Not legal advice. Prepared by an AI research assistant on 2026-11-07 (pass 5) from brief Issue 4, for review by a
> qualified lawyer. Every position below is provisional. The full analysis and sources are in [research.md](research.md);
> the product is described in [brief.md](brief.md).

**The business.** SEMICS LTD (England and Wales) makes two EmDash plugins, Events and E-sign. Free editions are MIT
licensed. Pro editions are to be sold as yearly licences to businesses and consumers in the UK, EU and US. Site owners run
the plugins on their own sites; signing data never reaches SEMICS.

**Three launches.** "Blocks" below names which one:

- **Checkout:** taking payment for Pro.
- **E-sign 1.0:** BUILD-PLAN D4 requires a lawyer's review before 1.0.
- **Waivers:** the Events Pro waiver feature, including waivers signed for children.

## Read first: Paddle has not accepted SEMICS as a seller

**The fact.** On 26 October 2026 Paddle emailed the owner that its domain review of semics.co.uk meant it was "not able to
activate your account to take payments". It offers an appeal or a new application. No appeal is on record. We have this
second-hand, from the coordinator and `tasks/T156-legal-pass-4-fixes.md`, and have not seen the email (section 4, fact 1).

Every text that calls Paddle the seller, and research passes 1 to 4, assumed an active account. Until the owner resolves
this, the seller is unknown.

**Which questions depend on it.** Items 1, 2, 3, 4, 5 and 7 directly; item 6 in part; item 14 only as to SEMICS's own buyer
data. Items 8 to 13, 15 and 16 do not: they concern signing data on owners' sites, and ticket payments go through the
owner's own Stripe account.

**What changes with the seller.**

| Matter | Paddle activates | Another Merchant of Record | SEMICS sells directly |
| --- | --- | --- | --- |
| Who is the trader | Open (item 1) | Open; depends on its terms | SEMICS, beyond doubt |
| UK subscription rules, EU withdrawal button, pre-contract information | Open: public pages cover some of it | Our Paddle analysis does not carry over; read its terms afresh | All on SEMICS, and SEMICS must build what is missing |
| Risk passed back | Warranty, indemnity, refund fees | Unknown | Nothing to pass; SEMICS is liable directly |
| Tax on sales | Seller charges it | Seller charges it | SEMICS must register and account. "Including UK VAT" is true only if it is VAT registered. Not researched; needs a tax adviser |
| Site text and licence §1 | Stand, subject to items 2 to 7 | Replace every Paddle reference | Rewrite /terms, /refunds, /pricing, /privacy and licence §1 and §7 |
| Privacy | Paddle is an independent controller | Check the same point | SEMICS controls billing data and names its payment processor |
| EU representative (Art 27) | Open | Open | Stronger case that one is needed |

A different seller also means rebuilding the licence service, which runs on Paddle notifications. That is an owner and code
cost, not a legal question.

**Are the live pages a problem now?** Provisionally yes: modest today, and growing the longer the position lasts. All six
pages naming Paddle were checked live. Nobody can buy yet, because there are no buy links, which limits the harm. See item 2.

## 1. What we need from you

Ranked: blockers first, Checkout before E-sign 1.0 before Waivers.

### 1. Who is the seller and the trader?

- **Question.** If Paddle activates, is Paddle or SEMICS the "trader" for each consumer duty, and how far do Paddle's seller
  terms return the risk to SEMICS? If Paddle does not, is a direct sale or another Merchant of Record acceptable, and what
  is the minimum needed to do it lawfully?
- **Touches.** /terms "How you buy"; licence §1; /refunds; /pricing; brief §10, §13 Q17.
- **Our position.** With an active Paddle account: probably Paddle for the sale, SEMICS for its own pages and the licence.
  No public text says Paddle accepts these duties. The commercial risk returns to SEMICS (cl 10.4, 11.1, 11.2).
- **Risk if wrong.** Enforcement, and liability for duties each party assumed the other carried.
- **Blocks Checkout.** Low confidence. [Q17](research.md#q17-the-product-sites-terms-refunds-privacy-and-the-pro-licence).

### 2. Do the pages live today need changing, and is there exposure?

- **Question.** Do the present-tense statements about Paddle, "online checkout opens soon" and the priced `LAUNCH40` offer
  breach DMCCA 2024 s.226 or Sch 20 para 5 (or para 4), given what SEMICS has known since 26 October? Does our replacement
  wording cure it?
- **Touches.** /pricing, /terms "How you buy", /refunds, /privacy "When you buy", /contact, licence §1.
- **Our position.** Yes, change them now; the owner need not wait for your answer. /pricing can be an invitation to purchase
  even though buying is not yet possible (CMA209 paras 2.3, 2.4). Para 5 bans inviting purchase at a stated price without
  disclosure, where the trader has reasonable grounds to believe it cannot offer the product, or procure another trader to.
  Whether SEMICS has such grounds turns on the appeal and other routes, which are open today. Para 4 (false claim of
  approval) looks weak. Proposed line: "Pro is not on sale yet. We are still arranging who will handle checkout and cannot
  say when it will open. These are the prices we plan to charge."
- **Risk if wrong.** Banned practices are always unlawful (CMA209 note 20). Real-world harm is small while no sale is possible.
- **Blocks Checkout, and the wording should change now.** Medium confidence.

### 3. Do the sale and renewal terms meet the consumer cancellation and subscription rules?

- **Question.** For a yearly renewing licence: who must send the earlier reminder and the day-one cooling-off notice (UK, from
  1 January 2027 if the draft Regulations are made), who provides the EU withdrawal button (Art 11a), and is a 14-day
  refund "for any reason" the right promise?
- **Touches.** /terms "Renewal and cancelling"; /refunds; licence §7; checkout flow.
- **Our position.** Paddle's public pages show one reminder, a discount-end reminder, a UK renewal window and an EU
  button. They do not show the earlier reminder or the separate notice. Paddle has not answered our question of 2 November.
  The Regulations are still draft, and contracts made earlier are outside them. Paddle's general refunds are discretionary,
  so SEMICS's promise depends on a route it does not control.
- **Risk if wrong.** Under the draft rules, the cooling-off period can run up to 12 months longer if the notice is missed.
  Enforcement, and refunds.
- **Blocks Checkout for consumers.** Selling to businesses only would avoid it; the owner rejected that in T156 but may
  want to revisit it if the seller changes. Low confidence. [Q17](research.md#q17-the-product-sites-terms-refunds-privacy-and-the-pro-licence).

### 4. Do the prices meet the total-price rules?

- **Question.** (a) UK: does a dollar total including VAT meet s.230 if checkout charges pounds, or a converted price? (b) EU:
  what must the page show, given that VAT varies by country? (c) Is showing the before-tax figure first acceptable to a
  mixed audience?
- **Touches.** /pricing; `LAUNCH40` line; /terms "What you get".
- **Our position.** (a) A real improvement, and probably sufficient if the dollar total is what the buyer pays. Unclear if
  Paddle converts: no source we read deals with a UK seller quoting dollars to UK consumers (the CMA's currency passage
  concerns foreign charges). Showing the actual sterling price would remove the doubt. (b) Not met, in our view. Art 7(4)(c) of
  the EU Directive asks for the price including taxes, or how it is calculated; "where it applies" does neither. (c) Probably
  fine: both figures have the same styling and size.
- **Risk if wrong.** A misleading omission, in the UK and in each EU state targeted.
- **Blocks Checkout.** Medium (UK), low (EU). [Q17](research.md#q17-the-product-sites-terms-refunds-privacy-and-the-pro-licence).

### 5. Is the refund rule in the licence fair and enforceable, and does §7 work?

- **Question.** May a refund end the licence (first purchase) or a year (renewal), and close the licence to further keys and
  support? Does that survive CRA 2015 s.47(2)(b) and (c) where the refund is for a fault? What should happen when a
  chargeback is reversed in SEMICS's favour? Is the §7 survival sentence right?
- **Touches.** Licence §4, §7; /refunds "After a refund"; /terms "Renewal and cancelling"; /pricing.
- **Our position.** Sound for the 14-day no-reasons refund. Doubtful for a fault refund: §7's saving keeps "any other remedy"
  but still ends the licence, so a buyer whose product failed loses the versions that worked. Three drafting points:
  - §4 and §7(b) protect versions "released during" the term, so the version current on purchase day is not literally
    covered, though /terms says it is. Suggested: "released before the end of".
  - §7's duty to stop using is not listed as surviving after (a) or a breach ending.
  - Nothing covers a reversed chargeback, and the code leaves that licence closed.
- **Risk if wrong.** Term not binding on consumers; dispute over what a buyer keeps. Enforcement rests only on contract and
  copyright, because a key cannot be switched off.
- **Blocks Checkout.** Medium. [Q17](research.md#q17-the-product-sites-terms-refunds-privacy-and-the-pro-licence).

### 6. Are the liability limits, governing law and licence scope acceptable?

- **Question.** Is the cap at one year's fee, with lost profits and unforeseeable loss excluded, reasonable for business buyers
  (UCTA s.11) and effective for UK consumers on digital content quality? Is the governing-law clause right? Does the licence
  need to cover evaluators and free keys?
- **Touches.** /terms "Our responsibility", "Changes and law"; licence §1, §3, §8, §9.
- **Our position.** Terms are drafted to preserve non-excludable liability and consumers' home-law rights. §1 and §3 license
  only "the person ... that bought", so evaluators on preview hosts and holders of owner-issued keys have no stated licence.
  Each text is "Version 1.0" although the wording has changed; it needs a new number after your review.
- **Risk if wrong.** Cap falls away; uncertainty over who is licensed.
- **Blocks Checkout.** Medium (consumer), low (business). [Q17](research.md#q17-the-product-sites-terms-refunds-privacy-and-the-pro-licence).

### 7. Is the privacy policy right, and is an EU representative needed?

- **Question.** Are the legal bases, rights list and retention periods sound? Does selling to EU buyers require an Art 27
  representative, given the seller outcome?
- **Touches.** /privacy.
- **Our position.** Bases and rights look conventional. Periods are proposed (licence records 6 years, notification records 1
  year, support email 2 years). Art 27 is unresolved; Art 3(2)(a) may apply even with a reseller.
- **Risk if wrong.** Regulatory exposure, modest at this scale; a missing representative is a plain breach if one is required.
- **Blocks Checkout.** Rewrite first if the seller is not Paddle. Medium. [Q12](research.md#q12-roles-and-contracts).

### 8. Is the consent wording enough? (Q1, Q2)

- **Question.** Is the default sentence, with a separate intent box, sufficient for consumers in England and Wales, the EU and
  the US? Which documents need §7001(c) disclosures, and should a US disclosure option be on by default for US sites? What
  must be added beside the boxes?
- **Touches.** Consent setting and intent sentence (section 2).
- **Our position.** Two statements are sound. §7001(c) is usually not triggered by the waiver itself. Add a privacy-notice link
  and a line on copies and retention.
- **Risk if wrong.** Signatures still likely valid in most cases, but disclosures may fail where a law requires them in
  writing; missing Art 13 information at collection.
- **Blocks E-sign 1.0.** Medium (E&W, US), low (EU). [Q1](research.md#q1-consent-wording-for-the-us),
  [Q2](research.md#q2-consent-wording-for-ukeu-consumers).

### 9. Are the retention defaults right? (Q4, Q5 in part)

- **Question.** Are 12 months and 7 years suitable defaults? Should envelopes signed by a guardian have a longer default (for
  example 21 years), and is it defensible to keep names in the PDF for the whole period?
- **Touches.** `retentionPersonalDataMonths`, `retentionSignedRecordsYears`; operator guide; brief §9.
- **Our position.** 7 years suits adult contracts in England and Wales. It is too short for a child's injury claim, which can
  run to 21 or later; a longer period raises its own minimisation question. The name is defensible.
- **Risk if wrong.** Record gone when needed, or data kept too long, for every owner who keeps the defaults.
- **Blocks E-sign 1.0.** Medium (E&W), low (EU, US). [Q4](research.md#q4-retention-periods),
  [Q5](research.md#q5-name-and-ip-kept-for-7-years-inside-the-pdf).

### 10. What should the certificate print? (Q5 in part, Q6, Q7)

- **Question.** Full, truncated or no IP by default? Should co-signers see each other's IPs and entered values? Is a child's name
  acceptable? Should new fields default to "operational only"?
- **Touches.** `packages/esign/src/domain/pdf.ts`; brief §5.3, §5.5.
- **Our position.** Truncated or none by default; no other signers' full IPs; keep the child's name, since without it the
  waiver does not say whom it covers; let each field choose whether it prints.
- **Risk if wrong.** Disclosure with no clear purpose across every multi-signer envelope, on records kept for years and hard to
  change afterwards.
- **Blocks E-sign 1.0.** Medium. [Q7](research.md#q7-ip-addresses),
  [Q6](research.md#q6-certificate-contents-and-data-minimisation).

### 11. Guardian signing and waivers for children (Q8)

- **Question.** Is signing on the buyer's word acceptable with a required statement of authority? Should whole-group mode exist
  for adults? What may we tell owners a waiver achieves, and in which US states and Member States?
- **Touches.** Events Pro waiver flow; `docs/protocol/esign-intent-v1.md`; `apps/docs/pages/waivers.md`.
- **Our position.** A waiver cannot exclude negligent injury liability to UK consumers, or in standard terms in Germany. US states
  split (seven checked; not complete). Require the statement; do not offer whole-group mode for adults.
- **Risk if wrong.** Owners rely on a void waiver or on an unauthorised signature, after a child is injured.
- **Blocks Waivers.** Low.
  [Q8](research.md#q8-guardian-signing-for-minors).

### 12. Notice to other adults (Q11)

- **Question.** Is the proposed invitation line enough for Art 14, and must the buyer confirm they may share other attendees'
  addresses?
- **Touches.** `packages/esign/src/emails/templates.ts`; privacy-notice setting.
- **Our position.** The owner gives notice, at the latest in the invitation; the line and link suffice.
- **Risk if wrong.** Owners breach Art 14 on every invited attendee, using our default text.
- **Blocks Waivers.** Medium. [Q11](research.md#q11-notice-to-other-adults).

### 13. What the certificate says about itself (Q9, Q10)

- **Question.** Approve replacement wording for the verify sentence and the "Identity check" row; should the signing page state
  that identity is not verified?
- **Touches.** `CERTIFICATE_WORDING` in `pdf.ts`; `PDF_CERTIFICATE_WORDING`; signing page.
- **Our position.** No law requires an anchor. The current wording overstates slightly, so use the drafts in research.
- **Risk if wrong.** Overclaiming on documents that cannot be reprinted later, so earlier is better.
- **Can follow,** though best settled before 1.0. Medium.
  [Q9](research.md#q9-tamper-evidence-without-an-external-anchor), [Q10](research.md#q10-identity-assurance).

### 14. Roles, owner templates and subject requests (Q12, Q13)

- **Question.** Would support access to an owner's site make SEMICS a processor, and on what terms? Is the erasure justification
  text right? What should the owner pack contain?
- **Touches.** Owner docs (`apps/docs/pages/privacy.md`); support practice.
- **Our position.** Owner is controller; SEMICS is neither for signing data unless it gets access. Partial erasure relying on
  Art 17(3)(e) is lawful if explained.
- **Risk if wrong.** Unpapered processing during support; owners give poor responses to requests.
- **Can follow.** Medium. [Q12](research.md#q12-roles-and-contracts), [Q13](research.md#q13-subject-requests).

### 15. Uploaded PDFs: is a link enough notice? (Q16)

- **Question.** In England and Wales and the EU, is offering a document by link, with an explicit tick, enough? Must the signer
  open it?
- **Touches.** Signing page; `packages/esign/src/astro/SigningCeremony.astro`.
- **Our position.** A recognised pattern in the US. UK and EU incorporation rules were not researched.
- **Risk if wrong.** A signer disputes having seen the terms.
- **Can follow** (Pro PDF feature). Low (UK, EU). [Q16](research.md#q16-uploaded-pdfs).

### 16. Which documents should the warning list? (Q15)

- **Question.** What should the list say for England and Wales and the main EU states?
- **Touches.** Template editor warning; docs (not yet written).
- **Our position.** Warn, do not filter. The US list is done; UK and EU lists are incomplete.
- **Risk if wrong.** Incomplete warning; owners remain responsible for their own documents.
- **Can follow.** High (warn), low (list). [Q15](research.md#q15-excluded-document-types).

## 2. Documents to approve

| Text | Who sees it | Source | Needs |
| --- | --- | --- | --- |
| Pro licence | Buyer | `apps/site/pro-licence.txt`; Pro repo `packages/{esign-pro,events-pro}/LICENSE` | Approval |
| Terms of sale | Buyer | `apps/site/pages.mjs`, `terms` | Approval |
| Refund policy | Buyer | `apps/site/pages.mjs`, `refunds` | Approval |
| Pricing page | Buyer | `apps/site/pages.mjs`, `pricing` | Approval |
| Privacy policy | Buyer | `apps/site/pages.mjs`, `privacy` | Approval |
| Licence and refund emails | Buyer | Pro repo `packages/licence-worker/src/handlers.ts`, `keyMail`, `sitesMail`, refund intro | Read-through, after the fixes in section 3 |
| Contact and home pages | Visitor | `apps/site/pages.mjs`, `contact`, `home` | Read-through |
| "How Pro works" | Buyer | `apps/docs/pages/editions.md` | Read-through |
| Checkout, receipts and reminders | Buyer | The seller's | Read-through once the seller is known |
| Consent wording (default) and intent sentence | Signer | `packages/esign/src/domain/signing.ts`; `packages/esign/src/astro/SigningCeremony.astro` | Approval |
| Certificate wording | Signer | `packages/esign/src/domain/pdf.ts`; Pro repo `packages/esign-pro/src/domain/pdf-templates.ts` | Approval |
| Invitation and completion emails | Signer | `packages/esign/src/emails/templates.ts` | Approval (notice line, item 12) |
| Guardian statement | Signer | Not written yet (item 11) | Approval once drafted |
| One-time code and reminder emails | Signer | Pro repo `packages/esign-pro/src/otp/routes.ts`, `src/routing/reminders.ts` | Read-through |
| Verify page | Anyone | `packages/esign/src/astro/VerifyDocument.astro` | Read-through |
| Public signing form | Signer | Pro repo `packages/esign-pro/src/selfserve/routes.ts` | Read-through |
| Operator guides on privacy and waivers | Site owner | `apps/docs/pages/privacy.md`, `waivers.md`, `esign.md` | Read-through |
| MIT licence for Free | Anyone | Repository licence | Nothing |
| Owners' own documents and templates | Signer | Each owner's | Nothing; the owner's responsibility |

The published 1.0.0-rc.4 package carries the earlier licence text; the current text ships in the next release. Approve the
text, give it a new version number, then release.

## 3. Not for the lawyer

These should not need paid time. Anything here that still touches an approved document is covered only by the read of that
document.

| Item | Reason |
| --- | --- |
| Q3: store and print the consent wording | No authority either way and no legal downside: the wording is not personal data. Owner decision; research recommends yes |
| Q14: label on the "viewed" event | No law requires one; the label should match what it records. Owner decision |
| Q9 in part: is an external anchor required? | No law requires one for a simple signature. Only the wording goes to item 13 |
| Q16 in part: original plus update, or flattened | No rule found; keeping the original bytes preserves the hash check. Only the notice goes to item 15 |
| ESIGN §7001(c) scope, "simple" signature, limitation periods in Q4 | Checked against primary text; the brief is now right |
| Whether to appeal, re-apply or change seller | Owner's commercial decision. Item 1 covers the legal consequences |
| Next charge after a refund | Fix, do not judge. Paddle's policy treats cancelling as separate, and the licence service refuses the next payment with no key or notice. No reading makes charging for nothing acceptable. Cancel the subscription on refund, then rewrite /refunds' "cancel any renewal you do not want" |
| Refund email text | `handlers.ts` says the registry token is "unchanged" and then revokes it, offers "Questions" after §7(b) ends support, and gives an `npm install` line that resolves to a placeholder on `latest` |
| Refund email failure | If the mail fails, the retry is ignored: no key is sent and the licence stays open, against §7(b)'s promise. Code bug (read, not run) |
| Reversed chargebacks and warnings in code | `chargeback_reverse` and `chargeback_warning` are ignored. The behaviour follows once item 5 is answered |
| Count of 14 days | Statute counts from the day after renewal (s.265(2)(b)); say "14 days starting the day after", which costs at most a day |
| VAT arithmetic and page wording on hostnames | Checked: all prices compute correctly; /pricing, /terms and the code agree on hostnames |
| Tax words in `editions.md` and the /pricing meta description | Both give before-tax prices, and `editions.md` does not say so. Use the same wording as /pricing; the rule is clear |
| Complaint invitation in /privacy | s.164A duty is clear and in force; add the line. Read as part of item 7 |
| "Under legal review" note on /licence | True only once a lawyer has it. Until then, say "awaiting legal review" |
| Paddle's reminders, portal, refund handling | Paddle facts, listed in section 4 |
| VAT, EU VAT and US sales tax if selling directly | For a tax adviser, not this instruction |

## 4. Facts we have not established

| # | Fact | Who supplies it |
| --- | --- | --- |
| 1 | The Paddle email itself; whether appealed; outcome; which domains were submitted, including plugins.semics.co.uk | Owner |
| 2 | The seller decision, if Paddle says no | Owner |
| 3 | Any contract in force with Paddle, and whether it differs from the public terms | Owner, Paddle |
| 4 | Answer to the 2 November question on reminders, notices and the withdrawal button | Paddle |
| 5 | Whether a refund stops the next charge; how the portal behaves in practice | Paddle |
| 6 | Catalogue set-up: tax-exclusive, base currency, automatic conversion, any UK sterling price, whether the discount cap is real and whether a refund returns a use | Owner, Paddle |
| 7 | Whether anyone has bought, ordered or relied on a Pro price, or holds a key under earlier text; who holds owner-issued keys | Owner, code (licence store) |
| 8 | VAT registration and turnover | Owner |
| 9 | Expected buyers: consumer or business mix, target EU countries, US states | Owner |
| 10 | Confirmation of the proposed retention periods; the support mailbox provider and transfer safeguards | Owner |
| 11 | Insurance cover for these liabilities | Owner |
| 12 | Sites already signing real documents on current wording | Owner |
| 13 | Multi-signer routing as actually built (brief §12 describes it from notes) | Code |
| 14 | Whether the UK Regulations are made, and in what form | Public record (draft and unmade when checked on 2026-11-07) |

## 5. Convergence

**New substantive issues:** pass 5 found 7; pass 4 found about 9 (our count; pass 4 did not number them).

1. Paddle's refusal and the live pages' statements (supplied by the owner's email, not by research).
2. No total price or calculation for EU buyers.
3. A dollar total for UK consumers if checkout charges another currency.
4. Licence §4 and §7(b) literally omit versions released before the term.
5. Chargeback reversal is ignored by code and licence.
6. The refund email misstates the token and fails unrecoverably on a mail error.
7. §7's duty to stop using does not survive under its own survival sentence.

Only 1, 2 and 3 affect section 1 as decisions. 4, 5 and 7 add wording to item 5. 6 is code. The T156 fixes did resolve most of
what they targeted; see the table in [research.md](research.md#q17-the-product-sites-terms-refunds-privacy-and-the-pro-licence).

**Is another round likely to change section 1?** Another general round: no. Items 8 to 16 have not moved since pass 3, and more
reading would raise confidence, not change what is asked. A review of changed text will always find small drafting points;
those are for your read.

It is not finished, though, because the assumption under items 1 to 7 has just failed. What specifically would change section 1:

- **The seller is not Paddle:** items 1, 3, 4, 5 and 7 change substantially, and a narrow pass on that seller's terms, or on direct
  selling, is justified.
- **Paddle answers, or the portal is tested:** item 3 narrows, and may partly close.
- **The UK Regulations are made in a changed form:** item 3 changes.

**Suggested order.** The owner fixes the live wording and decides the seller. Items 8 to 16 can go to you now. Items 1 to 7 are best
instructed after the seller is known, except that you may be asked items 1 and 2 first to help make that decision.
