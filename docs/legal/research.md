# Legal research on the E-sign brief, Issue 2 (revised)

> Not legal advice. Prepared by an AI research assistant on 2026-11-02 from brief Issue 2 (as revised after the second
> research pass), for review by a qualified lawyer. Every view below is provisional.

Notes on method. This is the third pass. Primary sources were opened before being cited; numbers in square brackets
refer to the Sources list. Sources 1 to 61 come from earlier passes; those re-opened on 2026-11-02 are marked in the
list, the rest were not re-opened because nothing in the brief that relies on them has changed. Sources 62 onwards are
new. EUR-Lex again returned empty pages to the research tool, so the 2024/1183 amendment still rests on a third-party
copy of the Official Journal text [38], and EU Directive 2023/2673 (online withdrawal function) was found only through a
secondary source [67]. The Breyer judgment still could not be opened; the Court's press release on EDPS v SRB [65] was
opened and is used for Q5 and Q7. Parliament's statutory instrument tracker refused the request, so the approval status
of the UK subscription regulations is taken from the draft instrument itself [62]. California's automatic-renewal law
could not be opened (both official and mirror sites refused). The Pro licence was read in
`emdash-plugins-pro/packages/{esign-pro,events-pro}/LICENSE` (Version 1.0 draft; the two files agree on every line
spot-checked); the site text in `apps/site/pages.mjs` was compared with the live /pricing and /refunds pages, which
match [61].

## Summary table

| Q | Topic | Provisional view (one line) | Confidence | Needs lawyer to decide |
| --- | --- | --- | --- | --- |
| 1 | US consent wording | ESIGN §7001(c) applies only where a law requires information to be given to a consumer in writing; the waiver signature itself usually does not trigger it | Medium | Which owner documents trigger §7001(c); whether to ship a disclosure option |
| 2 | UK/EU consent wording | Wording is not legally required in England and Wales; two statements are sound; add a privacy-notice link and a line on copies and retention | Medium (E&W), low (EU) | Final wording; Member State formalities |
| 3 | Proving the wording | Store the wording text (and the intent sentence) per version and print both on the certificate | Medium | Whether printing it is wanted |
| 4 | Retention periods | 7 years suits adult contracts in E&W; it is too short for minors' injury claims, which can run to 21 or later | Medium (E&W), low (EU/US) | A separate default for guardian envelopes |
| 5 | Name and IP for 7 years | Name is defensible; a full IP for 7 years is harder to justify | Medium | Truncated or no IP on the certificate |
| 6 | Certificate contents | Signer's and minor's names are needed; entered values are the weak point | Medium | Per-field "print on signed copy"; child's name |
| 7 | IP addresses | IPs on the certificate are personal data for the owner; full IPs shown to co-signers are the main problem | Medium | Full, truncated or none |
| 8 | Guardian signing, minors | In E&W and Germany negligence injury liability cannot be excluded by standard consumer terms; US states split (CA, OH allow parental releases in some settings; TX, NJ do not; CO, FL only in part) | Low | Statement of authority; whole-group mode |
| 9 | No external anchor | Enough for a simple signature; the verify sentence overstates slightly | Medium | Final certificate wording |
| 10 | Identity assurance | Email control is a fair basis for low-value documents if the limit is stated; "Identity check" overclaims | Medium | Wording on page and certificate |
| 11 | Notice to other adults | Site owner (controller) must give Art 14 notice, at the latest in the invitation email | Medium | Notice text; buyer's confirmation |
| 12 | Roles and contracts | Owner is controller; maker is neither for signing data, but is controller of licence-buyer data | Medium | Templates the maker supplies; support access |
| 13 | Subject requests | Partial erasure relying on Art 17(3)(e) is permitted if justified and explained; manual access handling is lawful; complaints duty now in force | Medium | Justification text; export tool |
| 14 | Mail-scanner prefetch | No legal requirement for a view event; the label should say what it records | High | Whether to log link fetches separately |
| 15 | Excluded documents | Yes, warn; list headline categories, do not filter | High (warn), low (completeness) | List contents per region |
| 16 | Uploaded PDFs | Original plus incremental update is good evidence; a conspicuous link plus an explicit tick is a recognised US pattern | Medium (format, US), low (UK/EU notice) | Whether "offered by link" is enough |
| 17 | Site terms, refunds, privacy, Pro licence | Most pass-2 points are fixed. Open: the refund page and the licence disagree on whether a refunded buyer keeps a right to use; the licence is not published where buyers can read it before paying; the draft note ships in the package; business-buyer cap; EU withdrawal button and UK 2027 rules depend on Paddle | Medium (UK), low (EU, US) | Refund and survival rule; business cap; "trader" under Paddle; EU representative |

## Changes since the last pass

- **Brief changes found.** The brief keeps the label "Issue 2" but has been revised since the second pass (2026-10-26):
  §10 now lists what the licence service actually holds (email, hostnames, Paddle ids, no name) and the maker's vendors;
  §12 now says the Pro code for §5.6 [C36] was read; §14 calls question 17 new in this review; question 17 now describes
  a draft Pro licence (not a placeholder), the 14-day refund decision R89 (D6 updated), prices "plus VAT or sales tax",
  the licence-end wording, and privacy changes with an automatic retention job (R91). Questions 1 to 16 and sections 2
  to 9 and 11 are unchanged in substance.
- **Pro licence read for the first time as a draft** (Version 1.0). New findings are in Q17 and the corrections.
- **Site re-checked.** The privacy policy now names Paddle as an independent controller, gives legal bases, lists
  portability and objection; the licence Worker now deletes licence records 6 years after the latest of update term,
  cancellation or refund, and Paddle event records after 1 year (`licence-worker/src/retention.ts`, `store.ts`). The
  pass-2 privacy and licence-end points are resolved.
- **UK subscription rules re-verified.** The draft Consumer Subscription Contracts (Cancellation and Information)
  Regulations 2026 say they come into force on 1 January 2027 and need approval by both Houses [62]. The Act's renewal
  cooling-off (after a concessionary period and on renewals that run beyond 12 months) [63] and the extra reminder [64]
  were read in the Act itself. The sections are still marked prospective.
- **EU additions.** The online withdrawal function (Directive 2023/2673, from 19 June 2026) [67] and the pending Digital
  Fairness Act proposal (not yet published, not researched) added to Q17. EDPS v SRB (CJEU, 4 September 2025) [65] and
  the Council's Digital Omnibus position keeping the GDPR definition of personal data [66] added to Q5 and Q7.
- **Re-verified, unchanged:** Paddle buyer terms (31 March 2026) [52], Paddle privacy notice (16 March 2026) [53], DPA
  2018 s.164A now fully in force since 19 June 2026 [57].

## Q1. Consent wording for the US

**Question.** Is the default consent sentence enough under ESIGN/UETA for consumers, and are §7001(c) disclosures needed?

**Law.** US: ESIGN gives electronic signatures and contracts legal effect [1, §7001(a)]. The §7001(c)(1) consumer-consent
procedure (paper rights, withdrawal, scope, hardware and software, and consent that reasonably demonstrates access)
applies only where a statute, regulation or rule of law requires information to be provided to a consumer in writing
[1]. A contract is not invalid solely because the (c)(1)(C)(ii) consent was not obtained [1, §7001(c)(3)]. "Consumer"
includes the individual's legal representative [3]. UETA applies where the parties agreed to transact electronically,
judged from context and conduct (UETA §5(b) as enacted in West Virginia [4]).

**Provisional view.** The brief's §2 states the scope correctly. For the waiver or contract itself there is usually no
law requiring information to be "provided in writing", so §7001(c) is probably not triggered by signing, and the two
boxes are good evidence of UETA §5(b) agreement. It is triggered where the document carries a disclosure some law
requires in writing. Florida's mandatory capitalised notice in a parent's waiver [20] may be such a case; unclear.

**Confidence and gaps.** Medium. No court decision on §7001(c) and waivers was found.

**Suggested change, if any.** An optional "US consumer disclosure" setting covering the §7001(c)(1)(B) items, shown
before signing, with a confirmation that the signer could open the document in this form.

**For the lawyer.** Which of the owners' likely documents carry legally required written disclosures, and whether the
option should be on by default for US sites.

## Q2. Consent wording for UK/EU consumers

**Question.** Is the wording sufficient in the UK/EU, should it say more, and should consent and intent stay separate?

**Law.** UK: an electronic signature may not be denied legal effect solely because it is electronic [7]; electronic
signatures are admissible on authenticity [6]. The Law Commission says an electronic signature can execute a document if
the signer intends to authenticate it and formalities are met, and notes courts have accepted an "I accept" tick box
[11]. Art 13 requires identity, purposes, recipients and retention to be given at collection [28a]. EU: Art 25(1) is
the same and survives 2024/1183 unchanged [8][38]; recital 49 leaves the effect of non-qualified signatures to national
law [9].

**Provisional view.** English law does not require a separate consent to the electronic medium; the decisive element is
intent to authenticate, which the second box captures. Two statements are sound and mirror ESIGN/UETA. The page
collects personal data (name, IP, user agent, entered values), so Art 13 information must be available then; the brief
still describes no privacy-notice link on the page.

**Confidence and gaps.** Medium for England and Wales; low for the EU (national effect not surveyed beyond Germany).

**Suggested change, if any.** A privacy-notice URL setting, linked beside the tick boxes, and an optional line such as
"You will be emailed a link to the signed copy. [Owner] keeps the signed record for [N] years."

**For the lawyer.** Final wording, and whether any target Member State requires more for consumer contracts.

## Q3. Proving the wording later

**Question.** Should the consent text be stored per signature or printed on the certificate?

**Law.** UK: the party relying on a signature must prove what was signed and the intent to authenticate [11]. US: where
law requires a writing, a record may be denied effect if it cannot be retained and accurately reproduced [1, §7001(e)];
retention is met by an accurate, accessible, reproducible record [1, §7001(d)].

**Provisional view.** A hash proves the text only if someone can later produce the matching text. Relying on the owner
to archive every wording is a weak link, and the intent sentence is not hashed at all. The wording is not personal data,
so storing it costs nothing in data protection terms.

**Confidence and gaps.** Medium. An evidential judgement; no authority speaks to consent-wording hashes.

**Suggested change, if any.** Store each wording version immutably (keyed by its hash), print the consent wording and
the intent sentence on the certificate, and hash the intent sentence too.

**For the lawyer.** Whether printing both sentences is desirable (provisionally, yes).

## Q4. Retention periods

**Question.** Are 12 months and 7 years good defaults, especially for minors' waivers?

**Law.** England and Wales: simple contract, 6 years [12]; personal injury, 3 years from the later of accrual and
knowledge [13]; a minor is under a disability [16] and time runs from when it ends [14, s.28(1), (6)]; the court may
disapply the limits [15]. The brief's statement of these rules is correct. ICO: keeping data to defend possible claims
is legitimate if justified, "just in case" is not [33]. US: New York extends limitation for infancy to three years after
it ends, generally capped at ten years from accrual [25]; other states not checked. EU: not surveyed.

**Provisional view.** 7 years fits adult contracts in England and Wales (6 years plus a margin). It does not cover a
minor's injury claim: a child injured at 5 can sue until 21, and s.33 can extend that. A UK consumer waiver cannot
exclude negligence injury liability (Q8), so the record's value is chiefly as evidence of warnings and parental
agreement to take part. 12 months for separate copies is defensible because the signed record remains.

**Confidence and gaps.** Medium for England and Wales; low for the EU and the US.

**Suggested change, if any.** A separate records period for envelopes with a guardian signer (for example 21 years, or
"until the participant would be 21, plus one year" if a birth year were collected).

**For the lawyer.** The guardian-envelope default.

## Q5. Name and IP kept for 7 years inside the PDF

**Question.** Is keeping name and IP inside the signed record for the records period defensible?

**Law.** UK/EU: data limited to what is necessary and kept identifiable no longer than necessary [27, Art 5(1)(c), (e)].
ICO: retention to defend claims is legitimate if justified [33]. Art 17(3)(e) excepts legal claims [30]. EU: the Court
of Justice held that identifiability is assessed "at the time of collection of the data and from the point of view of
the controller", and that pseudonymised data are not personal data in all cases for every person [65].

**Provisional view.** The signer's name is defensible: a signed record without it proves little. Full IPs are harder:
their weight is modest without ISP records, and after 12 months the salt is deleted, so the printed IP can no longer be
checked against the chain (only against the whole-PDF hash). Keeping a full IP for 7 years "because it is in the PDF"
is a design consequence, not a purpose. SRB [65] may support treating the salted commitments as no longer identifying
once the salt is gone, but it does not help the clear-text IPs printed on the certificate, which the owner holds.

**Confidence and gaps.** Medium. No regulator guidance on e-signature certificates was found; SRB was read from the
press release only, and concerns EU institutions' Regulation 2018/1725.

**Suggested change, if any.** A setting for IP on the certificate: full, truncated (/24 or /48) or none, with the full
IP kept in the database until the personal-data purge.

**For the lawyer.** Which default, and confirmation that the owner's privacy notice must say that name and IP stay in
the signed record for the records period (Art 13(2)(a) [28a]).

## Q6. Certificate contents and data minimisation

**Question.** Which certificate items are necessary, and should a child's name be kept for 7 years?

**Law.** Art 5(1)(c) [27]. Children merit specific protection [31, recital 38]. Art 17(3)(e) [30].

**Provisional view.** Signer name: necessary. Minor's name: probably necessary, because without it a guardian waiver does
not say which child it covers; keep it but print nothing else about the child. Capacity, hashes, consent version and
times: necessary and low risk. Entered values are the weak point: an emergency contact is a third party's data needed
only for the event, and owners may ask for medical details, which may be special category data (Art 9; not researched).
Because the signature hash binds entered values, they can be left off the PDF and still be proved while the database
copy exists.

**Confidence and gaps.** Medium.

**Suggested change, if any.** A per-field template choice: "print on the signed copy" (terms the signer agreed to) or
"operational only" (removed at the personal-data purge, not printed).

**For the lawyer.** Whether operational-only should be the default for new fields; confirmation on the child's name.

## Q7. IP addresses

**Question.** Should IP addresses appear on the certificate, in full, truncated or not at all?

**Law.** EU: a dynamic IP is personal data for a website operator with legal means to identify the visitor through the
ISP (Breyer, C-582/14, press release [32]; judgment still not opened). Identifiability is judged from the controller's
point of view at collection [65]. The Council's October 2026 position on the Digital Omnibus keeps the current GDPR
definition of personal data; the proposal is not law and Parliament has no position yet [66, secondary]. UK: "online
identifier" is in the definition [26]; recital 30 names IP addresses [31]; ICO lists IPs among online identifiers [60].
US: no comparable rule found.

**Provisional view.** IPs are personal data for the site owner in the UK and EU, and nothing pending changes that. The
strongest point is one the brief does not raise: in a several-signer envelope every signer's copy shows every other
signer's IPs (and names and entered values). That is a disclosure to the other signers which needs a purpose; for IPs it
is hard to find one. A truncated IP keeps some evidential use with much less identifiability.

**Confidence and gaps.** Medium. The evidential weight of IPs in English courts was not researched.

**Suggested change, if any.** Default to truncated IPs (or none) on the certificate, keep full IPs in the database until
the personal-data purge, and do not print other signers' full IPs in several-signer envelopes.

**For the lawyer.** Default setting, and whether co-signers may see each other's entered values.

## Q8. Guardian signing for minors

**Question.** Is guardian signing on the buyer's word reasonable, are minors' waivers enforceable, and should the
whole-group mode exist?

**Law.** England and Wales: a trader cannot exclude liability for death or personal injury from negligence by a consumer
term or notice [17]; the same for business liability generally [18]. EU: such a term is indicatively unfair [19].
Germany: exclusion of liability for negligent injury in standard terms is ineffective (BGB §309 no. 7(a)); a minor needs
the legal representative's consent for transactions not merely to their benefit (§107) [42]. US (states checked: CA, CO,
FL, NJ, NY, OH, TX; not a complete survey): California courts have enforced parents' releases of ordinary negligence,
but not of future gross negligence [40]; Ohio lets parents bind children for nonprofit sport volunteers and sponsors
[39]; Texas courts have refused parental waivers (secondary source [41]); Colorado allows them by statute except for
wilful, wanton, reckless or grossly negligent conduct [21][22]; Florida only for inherent risks with a mandatory notice
[20]; New Jersey refuses them at commercial facilities [23]; New York voids negligence waivers at paid recreational
facilities for everyone [24].

**Provisional view.** In England and Wales and Germany parental authority is largely moot for negligence injury, because
no standard-terms waiver can exclude it, even an adult's. In the US the answer depends on the state and whether the
provider is commercial. Recording the buyer's assertion is reasonable if the buyer makes an explicit statement. The
whole-group mode records one adult's agreement only and, provisionally, should not be offered for adults.

**Confidence and gaps.** Low. Texas rests on a secondary source; Ohio's commercial position, other states and other
Member States not checked. Not re-researched this pass.

**Suggested change, if any.** A required, hashed guardian statement ("I am the parent or legal guardian of [participant]
and have authority to sign for them"). Allow Florida-style formatted notices in templates.

**For the lawyer.** Whether to drop whole-group mode for adults; which US states owners will use.

## Q9. Tamper evidence without an external anchor

**Question.** Is an internal hash chain enough for a simple signature, and is the certificate wording fair?

**Law.** UK/EU: an electronic signature is data "attached to or logically associated with" other data and used to sign
[10]; no integrity mechanism is required for a simple signature [7][8][38]. Admissibility on integrity [6]. US: copies
can be self-authenticated by matching hash values under a qualified person's certification [37, FRE 902(14)].

**Provisional view.** No law requires an external anchor for a simple signature; the chain and final hash are better than
most simple signatures offer. "Anyone holding this PDF can check these values on the verify page" overstates a little:
the check works only while the site keeps the record, and proves consistency with the site's own database, not
independent integrity.

**Confidence and gaps.** Medium.

**Suggested change, if any.** For example: "While [site] keeps this record, anyone holding this PDF can check on the
verify page that it matches. The record is held by [site]; no independent timestamp is used."

**For the lawyer.** Final wording, and whether "not matched" after deletion should say "no record held".

## Q10. Identity assurance

**Question.** Is email-inbox control fair for waivers and low-value agreements, and is the OTP wording fair?

**Law.** US: a signature is attributable to a person if it was their act, shown in any manner, including the efficacy of
a security procedure (UETA §9 as enacted [5]). UK: electronic signatures are admissible on identity; there is no
prescribed form [11][6].

**Provisional view.** Email control is the market norm for low-value documents and is fair if the product does not imply
more. Two points: inline signing (Events at the booking screen) involves no email control at all, so the certificate
should say how the signer reached the page; and the "Identity check" label overclaims, as §6 of the brief itself says
the code is not identity verification.

**Confidence and gaps.** Medium.

**Suggested change, if any.** A certificate line such as "Signer's identity not verified. Access: link emailed to
[masked address]" or "signed on the site's page during booking"; rename the row "Email access check: one-time code sent
to [masked address] entered at [time]".

**For the lawyer.** Whether the ceremony page should also tell the signer their identity is not verified.

## Q11. Notice to other adults

**Question.** Who gives privacy notice to attendees whose emails the buyer enters, and what should the invitation say?

**Law.** UK/EU: where data are not obtained from the data subject, the controller must give Art 14 information, and where
the data are used to communicate with the person, at the latest at the first communication [28]. The
disproportionate-effort exemption is unlikely to fit when the controller is emailing the person anyway [28].

**Provisional view.** The site owner, as controller, must give notice, and the invitation email is the natural place:
who is asking, that the buyer supplied the address, the purpose, and a link to the full notice. The 10-per-booking cap is
an abuse control; a signing invitation is probably not direct marketing (not researched).

**Confidence and gaps.** Medium.

**Suggested change, if any.** An invitation line: "[Buyer name] gave us your address when booking [event]. [Owner] uses
it only to ask you to sign this waiver. Privacy notice: [link]." Require the privacy-notice URL setting from Q2.

**For the lawyer.** Notice text, and whether the buyer should confirm they may share other attendees' addresses.

## Q12. Roles and contracts

**Question.** Is the owner the controller and the maker neither, and what should the maker supply?

**Law.** EDPB: not every service provider is a processor; the role follows concrete activities [36, para 82]. ICO: a
supplier is a processor where it processes data on the controller's behalf [35]. EU GDPR applies to a non-EU controller
offering goods or services to people in the EU [59, Art 3(2)(a)], which then needs an EU representative unless its
processing is occasional and low-risk [58, Art 27(2)(a)].

**Provisional view.** The site owner is the controller of signing data. The maker, supplying self-hosted software with no
access, is probably neither controller nor processor of it. The revised §10 now correctly describes the maker as
controller of licence-buyer data (email, hostnames, Paddle ids). Selling to EU buyers may bring SEMICS LTD within EU
GDPR and Art 27, although Paddle, not SEMICS, is the seller (Q17).

**Confidence and gaps.** Medium.

**Suggested change, if any.** Supply owners with a privacy-notice template for signers (Art 13/14 items), a record of
processing template, and a note on DPIAs for children's waivers. A DPA only if the maker ever gets access.

**For the lawyer.** Whether support access to an owner's site would make the maker a processor, and terms for that.

## Q13. Subject requests

**Question.** Is admin-run erasure that keeps the signed record acceptable, and is manual access handling enough?

**Law.** Art 17(3)(e) excepts processing necessary for legal claims [30]. ICO: a request may be refused wholly or partly,
with reasons within one month and remedies explained [34]. Art 15: access and a copy, limited to a reasonable and
proportionate search [29]. DPA 2018 s.164A, fully in force since 19 June 2026: controllers must facilitate complaints
(for example an electronic form) and acknowledge them within 30 days [57, re-opened].

**Provisional view.** Partial erasure is lawful if the owner can justify keeping the signed record for a plausible claim
within the limitation period and tells the person what was kept and why. Manual access handling is lawful, but data sit
in several places (signer record, audit events, PDF, outbox), which is error-prone within one month.

**Confidence and gaps.** Medium.

**Suggested change, if any.** After erasure, show the admin a short summary to send the requester (what was deleted,
what remains, until when, why). Consider an export of one signer's data.

**For the lawyer.** The standard justification text, and a complaints-handling note for owners (s.164A).

## Q14. Mail-scanner prefetch

**Question.** Is a view recorded only at first submit still meaningful, and should the certificate say so?

**Law.** No law found requires a "viewed" event for a simple signature under ESIGN, UETA or eIDAS [1][7][8].

**Provisional view.** The event means "a person had the page open and submitted it", which adds little to the consent
and signature events at the same moment. Calling it "viewed" invites the reading that it is when the signer first opened
the document, which is wrong. Not trusting page loads is sound.

**Confidence and gaps.** High that the label should match the behaviour; no authority either way.

**Suggested change, if any.** Label it "Opened and submitted", or add: "Page loads are not recorded because email
scanners open links automatically."

**For the lawyer.** Whether to record page loads separately as "link fetched (may be automated)".

## Q15. Excluded document types

**Question.** Should the product warn owners about documents that cannot be signed this way?

**Law.** US: ESIGN excludes wills and testamentary trusts, family-law matters, most of the UCC, court documents and
certain notices (utility cut-off, foreclosure or eviction, insurance cancellation, product recalls, hazardous materials)
[2]; UETA excludes wills and most of the UCC [4a]. England and Wales: deeds that must be witnessed need the witness
physically present [11]. EU: legal effect is for national law [9].

**Provisional view.** Yes. A short warning in the template editor and operator guide, naming headline categories per
region and telling owners to take advice, is cheap and reduces misuse. Automatic filtering is not feasible.

**Confidence and gaps.** High that a warning is prudent; low on completeness (UK wills and land formalities and EU
national exclusions not opened).

**Suggested change, if any.** Warning text with a link to a docs page listing the categories above.

**For the lawyer.** The list for England and Wales and the main EU states.

## Q16. Uploaded PDFs

**Question.** Is original-plus-incremental-update good evidence, and is offering the PDF by link enough?

**Law.** US: records must be accurately reproducible [1, §7001(d), (e)]; hash matching authenticates copies [37]. The
Ninth Circuit binds a user to online terms where the site gives "reasonably conspicuous notice" and the user takes an
action that unambiguously manifests assent; links must look like links, and explicit "I agree" boxes are routinely
enforced [43]. UK: admissibility on integrity [6]. No authority on PDF structure found.

**Provisional view.** Keeping the original bytes and appending an update is arguably better evidence than flattening,
because anyone can cut the file back and match `docSha256`; flattening would destroy that check. Later appended updates
are caught by `pdfSha256` and `/verify`. Berman suggests a US court would accept a document offered by a clearly styled
link if the signer ticks a box agreeing to that document; actual opening is not required. Requiring an open would make
the record stronger. English and EU incorporation rules were not researched.

**Confidence and gaps.** Medium on format and US notice; low for the UK and EU.

**Suggested change, if any.** Style the open and download links as links; name the file in the intent sentence
("...my signature on [file name]"); optionally require an open (recorded as a page action, not a fetch).

**For the lawyer.** Whether "offered by link" plus an explicit tick is enough notice in England and Wales.

## Q17. The product site's terms, refunds, privacy and the Pro licence

**Question.** Are the terms, refund policy, privacy policy and draft Pro licence fit for launch?

**Law.** Paddle's buyer terms (unchanged, 31 March 2026): Paddle is reseller, the supplier's terms govern use, UK/EU
consumers may withdraw within 14 days unless they used the product after agreeing to immediate supply, and Paddle sends
renewal reminders where law requires [52]. UK consumers: digital-content liability under CRA ss.34-37 and 41 cannot be
excluded or restricted [48]; grey list [49]; cancellation lost on express consent [44]. Business buyers: caps must be
reasonable [50]. UK subscriptions: the draft 2026 Regulations come into force on 1 January 2027 if approved, for
contracts made from then [62]; the Act gives a 14-day renewal cooling-off after a concessionary period and on renewals
running beyond 12 months [63], and an extra earlier reminder in those cases [64]. Total-price rule [45]. Rome I Art 6
[51]. EU: an online "withdrawal function" for consumer distance contracts applies from 19 June 2026 [67, secondary];
a Digital Fairness Act is expected but not yet proposed (not researched). Privacy: Art 13 [28a]; Paddle as controller
[53]; Art 27 [58].

**Provisional view.**
- **Fixed since pass 2:** real draft licence naming SEMICS LTD; refund 14 days everywhere (site, D6, licence, docs);
  price note; licence-end wording matches the code; Paddle as independent controller; legal bases, portability and
  objection; automatic 6-year and 1-year deletion built.
- **Refund versus survival.** The refund page says that after a refund "you no longer have a licence to use it". The
  licence says the right to versions released in the Update Term is perpetual and does not end on cancelling (§4), and
  that §4 survives any ending except termination for breach (§7). Read together, a refunded buyer arguably keeps a
  perpetual right. One text must change; a refund (and a chargeback) should probably end §4 rights expressly.
- **Incorporation.** The terms point to "the LICENSE file in each Pro package" without a link; buyers cannot read it
  before paying. Publish it on the site and link it from the terms and checkout.
- **Draft note.** The bracketed "Draft ... not by a lawyer" note sits in the shipped file and must go at launch.
- **Who is licensed.** §1 and §3(b) grant local and preview use only to "the person ... that bought the licence"; anyone
  trying Pro locally before buying has no licence.
- **Site versus hostname.** The licence counts production hostnames; the terms and pricing say "1 site ... identified by
  its hostnames". State whether `www` and the bare domain need two places.
- **Liability.** As in pass 2: the fee cap cannot bind UK consumers as to digital-content conformity; for business buyers
  a one-year-fee cap is common but its reasonableness is fact-based.
- **Renewal rules.** Paddle is the contracting seller, so it is probably the "trader" for the 2027 UK rules and the EU
  withdrawal function; confirm Paddle provides both. If the D5 first-year discount is used, it is a concessionary period
  triggering a cooling-off and a reminder [63][64]; it is not on the pricing page.
- **Privacy.** Remaining gaps: no mention of complaining to SEMICS first (s.164A [57]); EU representative not addressed.

**Confidence and gaps.** Medium for UK points; low for EU national law and US state law (California's automatic-renewal
law could not be opened). The draft regulations may change before approval.

**Suggested change, if any.** Align the refund page and licence §7; publish and link the licence; remove the draft note;
extend §3(b) to evaluators; define "site"; add a complaints line to the privacy policy.

**For the lawyer.** Whether refunded buyers keep any use right; the business-buyer cap; who is the "trader" under Paddle;
Art 27 representative; whether "plus VAT or sales tax" with the total at checkout meets DMCCA s.230 for UK consumers.

## Corrections to the brief

Status of the pass-2 corrections:

1. §2, ESIGN §7001(c) scope: **applied** (pass 2).
2. §12 reviewed Pro code: **mostly applied.** §12 now cites [C35] and [C36]; it still does not say whether the Pro
   routing for several signers (§5.5, [C34]) was read as code.
3. "Simple" signature not an eIDAS term: **applied.**
4. §10 licence service: **now applied.** It lists email, hostnames and Paddle ids, no name, and the maker's vendors.
5. Question 4 limitation rules: **applied and correct** [12]-[16].
6. "Identity check" label: **applied.**
7. Question 17 as new matter: **partly applied.** §14 calls it "new in this review", but its last line still lists
   question 17 among additions "before review" (T124).
8. Licence placeholder: **resolved**; question 17 now describes the draft licence.
9. D6 30 days: **resolved** (D6 now says 14 days, R89). The D5 first-year discount is still not on the pricing page.
10. Licence-end statements: **resolved** on the site and described in question 17.

New points:

11. The brief is still labelled "Issue 2" although it changed after the second research pass. Give it a new issue
    number or a revision date so the lawyer knows which text was reviewed.
12. Question 17 says the site states that after a refund "no new keys or updates are issued". Accurate, but it omits that
    the refund page also says the buyer "no longer [has] a licence to use it", which conflicts with licence §4 and §7
    (Q17).
13. Question 17 says the licence grants "one key per production hostname"; the licence actually issues one key per plan
    naming up to 1 (or 10) production hostnames, and the terms and pricing count "sites". Align the description.
14. Question 17 says the licence follows R90 "modification for own use, no redistribution"; it also grants rights to
    staff, contractors and agencies for clients (§3(e)), which the brief does not mention.

## Also noticed

- **Waivers cannot exclude negligence injury liability in the UK** [17][18] or, in standard terms, in Germany [42], and
  such terms are indicatively unfair in the EU [19]. Operator docs should say this plainly.
- **Co-signers see each other's data** on every signer's copy (Q7).
- **No privacy-notice link on the signing page** (Q2, Art 13 [28a]).
- **Florida-style statutory notices** need capitalised text at least 5 points larger [20]; templates should allow it.
- **International transfers.** Hosting on a US provider may be a restricted transfer for UK/EU owners; not researched.
- **Pro licence not readable before purchase**, and its draft note ships in the public package (Q17).
- **EU online withdrawal button** (from 19 June 2026) applies to EU consumer sales; confirm Paddle's checkout provides
  it [67].
- **US auto-renewal laws** (for example California) apply to US consumer buyers; not researched.

## Sources

Sources 1 to 61 were first accessed on 2026-10-26 or earlier; those marked "re-opened" were checked again on
2026-11-02. Sources 62 onwards were accessed on 2026-11-02.

1. 15 U.S.C. §7001, https://www.law.cornell.edu/uscode/text/15/7001, primary.
2. 15 U.S.C. §7003, https://www.law.cornell.edu/uscode/text/15/7003, primary.
3. 15 U.S.C. §7006, https://www.law.cornell.edu/uscode/text/15/7006, primary.
4. W. Va. Code §39A-1-5 (UETA §5 as enacted), https://code.wvlegislature.gov/39A-1-5/, primary.
4a. W. Va. Code §39A-1-3 (UETA §3 as enacted), https://code.wvlegislature.gov/39A-1-3/, primary.
5. W. Va. Code §39A-1-9 (UETA §9 as enacted), https://code.wvlegislature.gov/39A-1-9/, primary.
6. Electronic Communications Act 2000 s.7, https://www.legislation.gov.uk/ukpga/2000/7/section/7, primary.
7. UK eIDAS Art 25, https://www.legislation.gov.uk/eur/2014/910/article/25, primary.
8. eIDAS Art 25 as adopted by the EU, https://www.legislation.gov.uk/eur/2014/910/article/25/adopted, primary.
9. eIDAS recitals (recital 49), https://www.legislation.gov.uk/eur/2014/910/introduction, primary.
10. eIDAS Art 3, https://www.legislation.gov.uk/eur/2014/910/article/3, primary.
11. Law Commission, Electronic execution of documents, https://lawcom.gov.uk/project/electronic-execution-of-documents/,
    primary (law reform body).
12. Limitation Act 1980 s.5, https://www.legislation.gov.uk/ukpga/1980/58/section/5, primary.
13. Limitation Act 1980 s.11, https://www.legislation.gov.uk/ukpga/1980/58/section/11, primary.
14. Limitation Act 1980 s.28, https://www.legislation.gov.uk/ukpga/1980/58/section/28, primary.
15. Limitation Act 1980 s.33, https://www.legislation.gov.uk/ukpga/1980/58/section/33, primary.
16. Limitation Act 1980 s.38, https://www.legislation.gov.uk/ukpga/1980/58/section/38, primary.
17. Consumer Rights Act 2015 s.65, https://www.legislation.gov.uk/ukpga/2015/15/section/65, primary.
18. Unfair Contract Terms Act 1977 s.2, https://www.legislation.gov.uk/ukpga/1977/50/section/2, primary.
19. Directive 93/13/EEC Annex, https://www.legislation.gov.uk/eudr/1993/13/annex, primary.
20. Florida Statutes §744.301,
    http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0744/Sections/0744.301.html,
    primary.
21. Colorado Revised Statutes §13-22-107 (unofficial copy), https://colorado.public.law/statutes/crs_13-22-107, primary.
22. Cooper v. Aspen Skiing Co., 48 P.3d 1229 (Colo. 2002), https://caselaw.findlaw.com/co-supreme-court/1321668.html,
    primary.
23. Hojnowski v. Vans Skate Park, 187 N.J. 323 (2006), case brief,
    https://www.lexplug.com/casebrief/hojnowski_ex_rel_hojnowski_v_vans_skate_park_680860ce3f5cc0c6cc41b7e1, secondary.
24. New York General Obligations Law §5-326, https://www.nysenate.gov/legislation/laws/GOB/5-326, primary.
25. New York CPLR §208, https://www.nysenate.gov/legislation/laws/CVP/208, primary.
26. UK GDPR Art 4, https://www.legislation.gov.uk/eur/2016/679/article/4, primary.
27. UK GDPR Art 5, https://www.legislation.gov.uk/eur/2016/679/article/5, primary.
28. UK GDPR Art 14, https://www.legislation.gov.uk/eur/2016/679/article/14, primary.
28a. UK GDPR Art 13, https://www.legislation.gov.uk/eur/2016/679/article/13, primary.
29. UK GDPR Art 15, https://www.legislation.gov.uk/eur/2016/679/article/15, primary.
30. UK GDPR Art 17, https://www.legislation.gov.uk/eur/2016/679/article/17, primary.
31. UK GDPR recitals 30 and 38, https://www.legislation.gov.uk/eur/2016/679/introduction, primary.
32. CJEU press release 112/16, Breyer, C-582/14,
    https://curia.europa.eu/jcms/upload/docs/application/pdf/2016-10/cp160112en.pdf, primary (press release; judgment
    not opened).
33. ICO, Principle (e): storage limitation,
    https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/,
    regulator guidance.
34. ICO, Right to erasure,
    https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/,
    regulator guidance.
35. ICO, How do you determine whether you are a controller or processor?,
    https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/how-do-you-determine-whether-you-are-a-controller-or-processor/,
    regulator guidance.
36. EDPB Guidelines 07/2020 on controller and processor, version 2.1,
    https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf,
    regulator guidance.
37. Federal Rules of Evidence, Rule 902, https://www.law.cornell.edu/rules/fre/rule_902, primary.
38. Regulation (EU) 2024/1183, Art 1 point (23), via https://lawplayer.com/eu/act/32024R1183, primary text via a
    third-party copy (EUR-Lex returned an empty page again on 2026-11-02; confirm against
    https://eur-lex.europa.eu/eli/reg/2024/1183/oj).
39. Zivich v. Mentor Soccer Club, Inc., 82 Ohio St.3d 367 (1998), https://caselaw.findlaw.com/oh-supreme-court/1375990.html,
    primary.
40. City of Santa Barbara v. Superior Court, 41 Cal.4th 747 (2007),
    https://scocal.stanford.edu/opinion/santa-barbara-v-super-ct-33759, primary.
41. T. Dowell, Texas Agriculture Law blog, 20 January 2020,
    https://agrilife.org/texasaglaw/2020/01/20/will-texas-courts-enforce-liability-waivers-signed-on-behalf-of-minor-children/,
    secondary (Munoz v. II Jaz and Paz v. Life Time Fitness not opened).
42. German Civil Code (BGB) §§107, 309, English translation,
    https://www.gesetze-im-internet.de/englisch_bgb/englisch_bgb.html, primary (unofficial translation).
43. Berman v. Freedom Financial Network, LLC, 30 F.4th 849 (9th Cir. 2022),
    https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/05/20-16900.pdf, primary.
44. Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 reg 37,
    https://www.legislation.gov.uk/uksi/2013/3134/regulation/37, primary.
45. Digital Markets, Competition and Consumers Act 2024 s.230,
    https://www.legislation.gov.uk/ukpga/2024/13/section/230, primary.
46. Department for Business and Trade, Draft guidance on the Draft Consumer Subscription Contracts Regulations 2026,
    https://assets.publishing.service.gov.uk/media/6acf97da2de3184ccf8b814e/subscription-contracts-rules-guidance.pdf,
    government guidance (draft).
47. Wiggin LLP, DMCCA tracker, https://www.wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/,
    secondary (superseded for commencement by [62]).
48. Consumer Rights Act 2015 s.47, https://www.legislation.gov.uk/ukpga/2015/15/section/47, primary.
49. Consumer Rights Act 2015 Sch 2, https://www.legislation.gov.uk/ukpga/2015/15/schedule/2, primary.
50. Unfair Contract Terms Act 1977 s.11, https://www.legislation.gov.uk/ukpga/1977/50/section/11, primary.
51. Rome I Regulation Art 6 (UK retained version), https://www.legislation.gov.uk/eur/2008/593/article/6, primary.
52. Paddle Buyer Terms (31 March 2026), https://www.paddle.com/legal/checkout-buyer-terms, primary (third-party terms),
    re-opened 2026-11-02, unchanged.
53. Paddle Privacy Notice (16 March 2026), https://www.paddle.com/legal/privacy, primary (third-party notice), re-opened
    2026-11-02, unchanged.
54. Company, LLP and Business (Names and Trading Disclosures) Regulations 2015 reg 25,
    https://www.legislation.gov.uk/uksi/2015/17/regulation/25, primary.
55. Companies Act 2006 s.388, https://www.legislation.gov.uk/ukpga/2006/46/section/388, primary.
56. GOV.UK, Running a limited company: company and accounting records,
    https://www.gov.uk/running-a-limited-company/company-and-accounting-records, government guidance.
57. Data Protection Act 2018 s.164A, https://www.legislation.gov.uk/ukpga/2018/12/section/164A, primary, re-opened
    2026-11-02 (in force from 19 June 2026 so far as not already in force).
58. EU GDPR Art 27 as adopted, https://www.legislation.gov.uk/eur/2016/679/article/27/adopted, primary.
59. EU GDPR Art 3 as adopted, https://www.legislation.gov.uk/eur/2016/679/article/3/adopted, primary.
60. ICO, What are identifiers and related factors?,
    https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/what-are-identifiers-and-related-factors/,
    regulator guidance.
61. plugins.semics.co.uk, /pricing and /refunds re-fetched 2026-11-02 and matching `apps/site/pages.mjs`; /terms and
    /privacy read in source. Primary (the text under review). Internal files also read on 2026-11-02:
    `emdash-plugins-pro/packages/{esign-pro,events-pro}/LICENSE` (Version 1.0 draft),
    `emdash-plugins-pro/packages/licence-worker/src/{retention.ts,store.ts,handlers.ts,plans.ts}`,
    `apps/docs/pages/editions.md`, BUILD-PLAN D5 and D6.
62. Draft Consumer Subscription Contracts (Cancellation and Information) Regulations 2026,
    https://www.legislation.gov.uk/ukdsi/2026/9780348287912, primary (draft instrument; reg 1(2) commencement 1 January
    2027, subject to approval by both Houses).
63. Digital Markets, Competition and Consumers Act 2024 s.265 (renewal cooling-off period),
    https://www.legislation.gov.uk/ukpga/2024/13/section/265, primary (prospective).
64. Digital Markets, Competition and Consumers Act 2024 s.259 (timing of reminder notices),
    https://www.legislation.gov.uk/ukpga/2024/13/section/259, primary (prospective).
65. CJEU press release 107/25, EDPS v SRB, C-413/23 P, 4 September 2025,
    https://curia.europa.eu/jcms/upload/docs/application/pdf/2025-09/cp250107en.pdf, primary (press release; judgment
    not opened).
66. IAPP, "EU member states finalize Digital Omnibus negotiating stance", 22 October 2026,
    https://iapp.org/news/a/eu-member-states-finalize-digital-omnibus-negotiating-stance, secondary.
67. iubenda, "The new online withdrawal function: what EU Directive 2023/2673 means for your business",
    https://www.iubenda.com/en/blog/the-new-online-withdrawal-function-what-eu-directive-2023-2673-means-for-your-business/,
    secondary (Directive text on EUR-Lex not reachable).
