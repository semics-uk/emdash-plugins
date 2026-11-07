# Legal research on the E-sign brief, Issue 4

> Not legal advice. Prepared by an AI research assistant on 2026-11-07 from brief Issue 4, for review by a qualified
> lawyer. Every view below is provisional.

Notes on method. This is the fifth pass, and a narrow one: it reviews the T156 changes (`apps/site/pro-licence.txt`, the
/pricing, /terms, /refunds, /licence and /contact pages, brief Issue 4 and the licence service) and takes in one new fact
from the owner's mailbox: Paddle's refusal of 26 October 2026. Questions 1 to 16 are carried over unchanged and were not
re-researched, apart from one clause in Q12. The lawyer's starting point is now [sign-off.md](sign-off.md). Numbers in
square brackets refer to the Sources list; sources 87 onwards are new. Limits this pass: the date comes from the system
clock (2026-11-07), while the instruction said 2026-11-13 or later, so time-sensitive checks speak as of the access date;
the T156 commits are dated 2026-11-07. The Paddle email was not opened by this researcher; it is reported by the
coordinator and in T156 [97]. Web pages were read through a fetch tool that summarises, so short quotations should be
checked against the source. Parts of CMA209 were read directly from the PDF, only at the paragraphs named at [88]. The
licence service was read, not run. The Breyer judgment and California's automatic-renewal law remain unopened.

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
| 17 | Site terms, refunds, privacy, Pro licence | The seller is unconfirmed: Paddle refused the account, so every Paddle statement is an assumption and the live pages need changing. T156 resolved most drafting and code findings; §7 works for the 14-day refund but is doubtful for faults; the UK price is improved, the EU price is not addressed, and a dollar total is unclear if checkout converts | Medium (UK licence, UK pricing), low (seller and trader, EU, US) | Seller and trader; live statements; refund rule for faults; total price; subscription duties; Art 27 |

## Changes since the last pass

- **New fact: the seller is unconfirmed.** Paddle's email of 26 October 2026 says it cannot activate the account to take
  payments [97]. Passes 1 to 4 assumed an active account, and this file did not know. All of Q17's Paddle analysis is now
  conditional. T146's question to Paddle (sent 2 November) came after the refusal. T146's "live account" discount does
  not show the account can sell. Whether Paddle's seller terms bind SEMICS at all is unknown.
- **Live pages.** New finding in Q17: the Paddle statements, "opens soon" and the priced offer raise DMCCA s.226 and Sch 20
  para 5 [87][79][88].
- **T156 reviewed.** Most pass-4 drafting and code findings are resolved; see the status table in Q17. The licence service
  (version 7a85e157) is deployed; the licence text is not yet in a released package.
- **New problems T156 left or introduced** (Q17): versions released before the term; §7 not surviving its own sentence; no
  rule for a reversed chargeback [93][94]; refund email wording and a retry that loses the key [61]; the EU price; the
  currency question.
- **Upgraded.** "Paying for nothing after a refund" moved from a note to a launch fix: Paddle's policy treats cancelling as
  separate from a refund [68].
- **CMA209 full text** read in part for the first time [88]. It confirms the page can be an invitation before buying is possible.
- **UK regime, re-checked.** Regulations still draft and not found as made [62][86]. Start date 1 January 2027 unchanged.
- **Brief.** Issue 4 applies corrections 13 and 15 to 19. New corrections 20 to 22 below.
- **Questions 1 to 16:** no change, apart from the Paddle clause in Q12.

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
GDPR and Art 27, even if a reseller is the seller; who the seller will be is now unconfirmed (Q17).

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

**Question.** Are the terms, refund policy, privacy policy and Pro licence, as changed by T156, fit for launch, given that
Paddle has not accepted SEMICS as a seller?

**Law.**
- **Consumer terms.** Ambiguous consumer terms take the meaning most favourable to the consumer [82]. A digital-content
  term cannot make a statutory remedy subject to a restrictive or onerous condition, or allow a trader to put a person at
  a disadvantage for pursuing it [48, s.47(2)(b), (c)].
- **Prices and promotions (in force).** Unfair practices are prohibited; a trader includes one acting for business
  purposes [76]. False or misleading information relevant to a transactional decision is a misleading action [87]. An
  invitation to purchase must give the total price, including necessary taxes; where it cannot be calculated in advance,
  how to work it out, with equal prominence [45]. CMA: an invitation can exist before it is possible to buy, and the
  trader making it answers for it even if not the seller [88, paras 2.3, 2.4, 2.10]; a price should be "realistic,
  meaningful and attainable" [88, para 3.2]; VAT belongs in the total price [81]; drip pricing is prohibited; the
  responsible trader may not be the seller [80]; who qualifies for an offer must be explicit [88, para 5.50]. Banned: false
  limited-time claims; an invitation at a stated price where the trader has reasonable grounds to believe it cannot offer the
  product or procure another trader to, undisclosed [79, paras 5, 7][88, note 20]; false claims of approval by a body
  [79, para 4]; a true statement is "unlikely to be problematic" [80].
- **Currency.** s.230 does not mention it [45]. The CMA's currency passage concerns local charges on products supplied abroad
  [88, para 5.45]; it does not address a UK seller quoting dollars. The Price Marking Order treats sterling as the baseline but
  covers goods, not services; its guidance does not mention digital content [90].
- **UK subscriptions (draft).** Draft Regulations start on 1 January 2027 for contracts made from then [62, regs 1, 2]; they
  are not made [86]. A first-year discount is a concessionary period [78, s.254(3)]. An annual renewal is a relevant
  renewal, with a 14-day cooling-off counted from the day after [63][46, §6.3]. An additional earlier reminder is added on top
  of the standard one, at times stated in the key pre-contract information [64][46, §4.4]. A cooling-off notice must be given
  separately at the start; if not, the period runs up to 12 more months [62, reg 6][46, §6.4]. An email address alone is not an
  adequate online exit [46, §4.5.3]. Business contracts are outside [46, FAQ 3].
- **EU.** An invitation to purchase must give the price inclusive of taxes or, if it cannot reasonably be calculated in
  advance, the manner of calculation [89, Art 7(4)(c)]. Art 11a puts the labelled withdrawal function, confirmation step and
  durable acknowledgement on "the trader" [72]. Digital content loses withdrawal only with express consent, acknowledgement
  and confirmation [73, Art 16(m)]; after withdrawal the consumer must stop using it [73, Art 14(2a)]. An intermediary and the
  principal may both be traders [75]. Non-EU sellers to EU consumers should expect to be in scope [84, secondary].
- **Paddle.** See "Paddle and who bears the duty" below [52][68][69][70][71][91][92].

**The seller: read first.** Paddle's email says it completed a domain review of semics.co.uk and is "not able to move forward"
[97]. Paddle may reject products in its absolute discretion [69, cl 9.6(i)], and only approved domains may run live checkouts;
subdomains need their own approval, and a mistaken rejection is contested by replying to the email [92]. Its policy bars
"pure consulting" and "IT services" unrelated to a software offering, and crypto, adult and gambling offerings [91]; vehicle
checks are not mentioned there. How the listed categories relate to plugins.semics.co.uk is unknown. Consequences:
- **All Paddle analysis below is conditional** on activation. Nothing here shows the account is active or that a seller
  agreement is in force [69]. If the seller is SEMICS or another Merchant of Record, the "who bears the duty" section does not
  carry over, and SEMICS, if selling directly, is plainly the trader. `sign-off.md` sets out what changes in each case. Tax
  consequences were not researched.
- **Live pages: provisionally a problem, modest today.** /pricing, /terms, /refunds, /privacy, /contact and licence §1 state in
  the present tense that Paddle is the Merchant of Record for all orders, and /pricing says "every sale goes through Paddle",
  "online checkout opens soon" and "the code works once it does". The site was confirmed live with this text [61]. No sale can
  occur, so harm is limited, but "buy links are coming" does not stop /pricing being an invitation [88, paras 2.3, 2.4]. Para 5
  turns on whether SEMICS has reasonable grounds to believe it cannot offer the product at that price, itself or through another
  trader, for a reasonable period [79][88, note 20]. An appeal and other routes are open, so that is not made out today. It
  strengthens with time. Para 4 looks weak. s.226 is the likelier route [87]. Paddle's domain page asks for pricing and terms but
  names no required Paddle wording [92], so corrected text should not by itself harm an appeal; check with Paddle.

**Pass 4 findings against T156.**

| Pass 4 finding | Status | Note |
| --- | --- | --- |
| §4 contradicts §7 on a renewal refund | Resolved | §4 now defers to §7 as "the only exceptions" |
| Survival sentence takes away what §7 keeps | Mostly resolved | §3 to §9 continue after lapse and (b). Remainder below |
| "Licence ends" also means lapse | Partly | §7 now says "Update Term ends without renewal"; §6, /terms and /pricing still say "ends" |
| Which key after a renewal refund | Resolved in text | (b) replaces the key; the Worker emails one. See failure path below |
| Rule reaches chargebacks and partial refunds | Resolved, new gap | Licence now says so; reversal not covered |
| Rule reaches fault refunds (s.47) | Not resolved | Saving added, still ends the licence |
| Worker closes whole licence on a renewal refund | Resolved | Rolls back a year, emails a key, closes to new keys; deployed |
| Refunds page softer than licence | Resolved | Both "must"; /terms and /pricing defer. /refunds omits chargebacks and partial refunds |
| Draft marker hidden | Partly | Visible on /licence only; "under legal review" is not yet accurate unless a lawyer has it |
| "Same text ships in each package" | Resolved | Page says releases up to rc.4 carry earlier text; local files match |
| Version number after review | Not resolved | Still "Version 1.0" |
| UK ex-VAT and unpriced offer | Resolved for UK, subject to currency | Arithmetic checked; equal styling in `build.mjs`. Meta description and `editions.md` remain before-tax only |
| `LAUNCH40` not on page | Resolved | Whether a refund returns a use remains unstated |
| "Email to buy" | Resolved | Now depends on the seller |
| Hostname gap on /pricing | Resolved | |
| "Within 14 days" a day short | Not resolved | s.265(2)(b) counts from the day after [63] |
| Trader, reminders, cooling-off notice | Not resolved | Overtaken by the seller issue |
| Evaluators, s.164A, Art 27, business cap | Not resolved | T156 did not address them |
| Key email install line | Not resolved | `latest` is still the deprecated placeholder [85] |

**Provisional view: licence §7 as now drafted.** (a) and (b) work for the 14-day refund. Points that remain or are new:
- **Versions before the term (new).** §4 makes perpetual only versions "released during the Update Term", and (b) keeps those
  "released during the earlier years". A version current at purchase was released before. /terms says "every version released
  before its year of updates ended". They differ; a consumer gets the wider reading [82], but a business buyer may not. Use
  "released before the end of".
- **Survival (new).** After (a) or a breach ending, §§5, 6, 8 and 9 continue. The duties to stop using and delete sit in §7, which
  is not listed. Copyright probably fills the gap, but add §7. §2 is also not listed after lapse, though §3(a) and §4 rely on it;
  cosmetic.
- **Fault refunds.** §7's opening sentence defines the 14-day refund, then (a) and (b) say "a refund" without limit. /refunds
  promises a fault refund of the current year's fee, under the same "After a refund" rule. So a first-year buyer refunded for a fault
  must stop using everything. The saving ("any other remedy") does not undo that. It may offend s.47(2)(b) or (c) [48]; that is
  a judgement for the lawyer, and the ambiguity favours consumers [82]. Limiting (a) and (b) to the 14-day refund is the simple
  answer.
- **Chargebacks (new).** "A chargeback counts as a refund", but a contested chargeback can be reversed, returning the money
  [93][94]. The Worker ignores `chargeback_reverse`, so a licence closed by a chargeback SEMICS later wins stays closed. It also
  ignores `chargeback_warning`, under which the amount is refunded [93], and treats a partial chargeback as a full one [61]. The
  licence is silent on each. Paddle's adjustment `type` defaults to partial [94], so a refund of everything issued by line
  item would end nothing.
- **Closing the licence on a renewal refund.** A buyer who uses a cooling-off right cannot renew that licence. Probably acceptable
  as a new purchase remains open, but neither text says so. (b) covers any renewal while the Worker handles only the latest; since
  windows do not overlap this should rarely matter.
- **Paddle's policy.** It says access to the Product "will cease" on a refund [68, 1.6]. (b) keeps earlier versions. Probably
  consistent, since that is the refunded product only; unclear.
- **/terms.** "When a licence ends in any other way ... the key you already have keeps working" also catches a breach ending, which
  /terms never mentions. Technically true, but it reads as permission.

**Code and email (read, not run).**
- **Failure path (new).** `renewalRefunded` saves the rollback, then sends the email, then closes the licence. The mailer throws on
  failure and Paddle retries, but the retry finds `lastTransactionId` already moved and returns `ignored`. So: no key, licence not
  closed, token not revoked, against §7(b)'s "we will email you a key".
- **Email text (new).** The refund email says "Your registry access token is unchanged" just before it is revoked, ends "Questions:
  support" although (b) ends support, and gives the `npm install` line, which does not fetch the version the buyer may keep [85].
- **Next charge.** Paddle's policy treats cancelling as the separate step that stops billing and does not say a refund does [68, 3.1.3,
  3.5]; the developer pages are silent [93]. The Worker refuses a later charge with no key and no notice [61]. /refunds tells the buyer
  to "cancel any renewal you do not want", implying a closed licence could renew. Fix before checkout: cancel on refund, then rewrite
  the sentence.

**Refunds page against licence.** They now agree. /refunds does not mention chargebacks or partial refunds, which is acceptable if the
licence is shown before purchase.

**Pricing.**
- **UK.** Showing the total including VAT at the same size as the before-tax figure answers pass 4's main concern [45][81][88]; a
  breakdown beside a total is not the partitioned pricing the CMA warns about. Figures are correct.
- **Currency (new).** Paddle shows a country override, else an automatic local conversion, else the base price [95]. The page
  warns it "may show the price in your currency". If a UK buyer sees sterling, $94.80 is not the price charged, and neither a rate nor
  a sterling figure is given. Unclear whether this breaches s.230; it strains "attainable" [88, para 3.2]. Fix: a sterling price
  set in the seller's catalogue and shown on the page, or a pinned dollar charge. Not checked: the actual Paddle set-up.
- **EU (new).** T156 addressed UK only. EU buyers see "$79 before tax" and a UK VAT figure that does not apply to them. VAT varies
  but can be worked out by country, so Art 7(4)(c) probably requires either inclusive prices or a clear method [89]. "Paddle adds VAT
  ... where it applies" is neither. National implementation not surveyed. Simple options: a per-country table, a location-based preview
  [95], or a rate and worked example.
- **Other.** `editions.md` and the /pricing meta description give before-tax prices [61], and a minimal mention can still be an invitation
  [88, para 2.5]. A true cap of 100 remains fine, if real [79][80]; see the live-pages point above on availability.

**Hostname.** Resolved: /pricing, /terms, the licence and the code agree.

**Paddle and who bears the duty (only if Paddle activates).** T146 is out of date on one point: Paddle's Refund Policy (31 March 2026)
describes an online withdrawal button in the Customer Portal for EU consumers and, for UK annual subscriptions, a new 14-day window
at each auto-renewal, with UK requests made by contacting Paddle [68]. T146's other points are partly supported:
- **Reminders.** Paddle's 7-or-30-day reminder is confirmed, and a separate discount-end reminder exists [70][71]; T146
  omits the latter. But "every renewal gets a reminder" does not meet a rule requiring two for annual renewals [46]. Nothing
  public shows the earlier reminder, the day-one separate cooling-off notice, or which of 7 or 30 applies to the UK.
- **"Our 14-day refund covers the cooling-off."** Only in amount. Without the notice the statutory period extends [62, reg 6],
  and "within 14 days of" may be a day short of s.265(2) depending on the count [63].
- **The refund promise.** SEMICS promises a refund for any reason, but Paddle's general refunds are discretionary and
  SEMICS cannot pay directly [68][69]. Clause 10.1 suggests an agreed refund goes through; a buyer who goes to paddle.net,
  as the page invites, may be declined.
- **Who bears it.** Provisionally: Paddle is the seller, so probably the "trader" for the subscription contract and Art
  11a [52][69][68]. No public text says Paddle accepts the duty, and draft guidance in the pages read does not address
  resellers. Tiketa concerned an intermediary, so its fit is unclear and it is not English authority [75]. SEMICS stays
  directly responsible for its own pages [80][88, para 2.10], probably for the licence it signs with the buyer, and for any direct
  sale. Commercially the risk returns to SEMICS: it warrants legal compliance, indemnifies Paddle, and repays refunds with fees
  [69, cl 10.4, 11.1, 11.2].
- **If Paddle says no or stays unclear, settle before consumer checkout opens:** (1) EU: a SEMICS-run page meeting Art 11a(1)
  to (4) that forwards to Paddle, since email is not the function; (2) UK: SEMICS sends the earlier reminder and the
  cooling-off notice, and publishes the reminder window, which the licence service's Paddle data may allow; (3) or sell
  to businesses only, with a real check (rejected by the owner in T156, for the reason that it would turn consumers away); (4)
  written allocation with Paddle. Until then T146's "email or paddle.net is our withdrawal route" should point EU buyers to Paddle's
  button, and that is not yet tested.

**Still open from pass 3.** §1 and §3(b) license only "the person ... that bought", so evaluators have no licence; nor do holders of
owner-issued keys (`issueManualLicence`, no sale) [61]. The privacy page names the ICO but does not invite complaints to SEMICS first
(s.164A [57]). EU representative unresolved. Business-buyer cap unresolved [50].

**Confidence and gaps.** Medium on licence drafting and UK pricing. Low on the seller and trader, EU, Paddle's real behaviour (no
answer yet; portal not tested) and US law. The Regulations may change before approval. Reg 20 and regs 33 to 36 were read only
through the guidance. No source was found on a UK seller quoting a foreign-currency total to UK consumers.

**Suggested change, if any.** Live pages now: "Pro is not on sale yet. We are still arranging who will handle checkout and cannot say
when it will open. These are the prices we plan to charge." Licence: "released before the end of" in §4 and (b); limit (a) and (b) to
the 14-day refund and chargebacks; add a reversed chargeback; add §7 to the survival list; new version number after review.

**For the lawyer.** See [sign-off.md](sign-off.md), items 1 to 7.

## Corrections to the brief

Status of earlier corrections:

1. §2, ESIGN §7001(c) scope: **applied** (pass 2).
2. §12 reviewed Pro code: **applied.** §12 now says the Pro routing was described from Free seams and task notes, not code.
3. "Simple" signature not an eIDAS term: **applied.**
4. §10 licence service: **applied**, but see 21.
5. Question 4 limitation rules: **applied and correct** [12]-[16].
6. "Identity check" label: **applied.**
7. Question 17 as new matter: **applied** in Issue 3's §14.
8. Licence placeholder: **resolved.**
9. D6 30 days: **resolved.** The D5 discount is now on the pricing page (see Q17).
10. Licence-end statements: **resolved.**
11. Issue number: **applied** (Issue 4).
12. Refund wording in question 17: **applied.**
13. Key counting: **applied.** Issue 4 says one key per plan.
14. Question 17 omits §3(e) and the agency rights: **not applied.** It still lists only modification and no redistribution.
15. Refunds page and licence "agree": **applied.** Issue 4 states the rule without the claim.
16. "Identical" package text: **applied.** Issue 4 says releases after rc.4.
17. "One key per production hostname": **applied.**
18. Subscription bullet: **applied.**
19. How the licence service handles a refund: **applied**, but see 22.

New points:

20. Question 17 still has the old bullet "prices, which are now shown 'plus VAT or sales tax where it applies'". The page no longer
    says that, and a later bullet describes the current display. Delete the old one.
21. §10 and question 17 state Paddle's role as fact, and question 17 says only that Paddle "has been asked in writing". Neither
    mentions the refusal of 26 October 2026 [97]. Sections 10 and 13 should say the seller is unconfirmed.
22. Question 17 says the service "treats a chargeback as a refund" without saying that a reversal or warning is ignored (Q17, [61]).

## Also noticed

- **Waivers cannot exclude negligence injury liability in the UK** [17][18] or, in standard terms, in Germany [42], and
  such terms are indicatively unfair in the EU [19]. Operator docs should say this plainly.
- **Co-signers see each other's data** on every signer's copy (Q7).
- **No privacy-notice link on the signing page** (Q2, Art 13 [28a]).
- **Florida-style statutory notices** need capitalised text at least 5 points larger [20]; templates should allow it.
- **International transfers.** Hosting on a US provider may be a restricted transfer for UK/EU owners; not researched.
- **Key email install line.** The key email says `npm install <package>` with no tag [61], which today resolves to the
  deprecated placeholder on `latest` [85]. It is a licence point as well as a support one, because that package does not
  carry this licence.
- **Paddle FTC settlement.** Now opened, through Paddle's own FAQ only [96]: June 2025, $5 million, about two customers'
  telemarketing upsells; Paddle must keep screening higher-risk sellers and ensure clear subscription terms, consent and
  simple cancellation. The order itself was not read.
- **US auto-renewal laws** (for example California) apply to US consumer buyers; not researched.
- **Tax if selling directly.** UK VAT, EU VAT and US sales tax would fall on SEMICS; not researched, and a question for a tax adviser.

## Sources

Sources 1 to 61 were first accessed on 2026-10-26 or earlier; sources 62 to 67 on 2026-11-02; sources 68 to 86 on
2026-11-07 (pass 4); sources 87 onwards on 2026-11-07 (pass 5). Those marked "pass 5" were checked again this pass; others
were not, because nothing relying on them changed.

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
    third-party copy (EUR-Lex returned an empty page on 2026-11-02; not retried for this source; confirm against
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
    https://www.legislation.gov.uk/ukpga/2024/13/section/230, primary, pass 5.
46. Department for Business, Innovation, Science and Trade, Draft guidance on the Draft Consumer Subscription Contracts
    Regulations 2026 (October 2026),
    https://assets.publishing.service.gov.uk/media/6acf97da2de3184ccf8b814e/subscription-contracts-rules-guidance.pdf,
    government guidance (draft). PDF pages 1-11, 21-24, 26-27, 38-40, 48-49 and 59-61 read. Earlier passes labelled the
    department differently.
47. Wiggin LLP, DMCCA tracker, https://www.wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/,
    secondary (superseded for commencement by [62]).
48. Consumer Rights Act 2015 s.47, https://www.legislation.gov.uk/ukpga/2015/15/section/47, primary, pass 5.
49. Consumer Rights Act 2015 Sch 2, https://www.legislation.gov.uk/ukpga/2015/15/schedule/2, primary.
50. Unfair Contract Terms Act 1977 s.11, https://www.legislation.gov.uk/ukpga/1977/50/section/11, primary.
51. Rome I Regulation Art 6 (UK retained version), https://www.legislation.gov.uk/eur/2008/593/article/6, primary.
52. Paddle Buyer Terms (31 March 2026), https://www.paddle.com/legal/checkout-buyer-terms, primary (third-party terms).
53. Paddle Privacy Notice (16 March 2026), https://www.paddle.com/legal/privacy, primary (third-party notice).
54. Company, LLP and Business (Names and Trading Disclosures) Regulations 2015 reg 25,
    https://www.legislation.gov.uk/uksi/2015/17/regulation/25, primary.
55. Companies Act 2006 s.388, https://www.legislation.gov.uk/ukpga/2006/46/section/388, primary.
56. GOV.UK, Running a limited company: company and accounting records,
    https://www.gov.uk/running-a-limited-company/company-and-accounting-records, government guidance.
57. Data Protection Act 2018 s.164A, https://www.legislation.gov.uk/ukpga/2018/12/section/164A, primary (in force from
    19 June 2026 so far as not already in force).
58. EU GDPR Art 27 as adopted, https://www.legislation.gov.uk/eur/2016/679/article/27/adopted, primary.
59. EU GDPR Art 3 as adopted, https://www.legislation.gov.uk/eur/2016/679/article/3/adopted, primary.
60. ICO, What are identifiers and related factors?,
    https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/what-are-identifiers-and-related-factors/,
    regulator guidance.
61. plugins.semics.co.uk, /pricing re-fetched in pass 5 and matching `apps/site/pages.mjs`; other pages read in source. Primary
    (the text under review). Internal files read in pass 5: `apps/site/pro-licence.txt`, `apps/site/pages.mjs`, `apps/site/build.mjs`
    (styles), `apps/docs/pages/editions.md`, `emdash-plugins-pro/packages/licence-worker/src/{handlers,index,store,services}.ts` and
    the T156 tests, `emdash-plugins-pro/packages/{esign-pro,events-pro}/LICENSE` (matched by search on the new §7 wording, not
    line by line), `tasks/T146-licence-page-and-refund-wording.md`, `tasks/T156-legal-pass-4-fixes.md`.
62. Draft Consumer Subscription Contracts (Cancellation and Information) Regulations 2026,
    https://www.legislation.gov.uk/ukdsi/2026/9780348287912, primary (draft instrument; reg 1(2) commencement 1 January
    2027, subject to approval by both Houses). Pass 5: still marked draft. PDF pages 1-14 read directly in pass 4.
63. Digital Markets, Competition and Consumers Act 2024 s.265 (renewal cooling-off period),
    https://www.legislation.gov.uk/ukpga/2024/13/section/265, primary (prospective), pass 5.
64. Digital Markets, Competition and Consumers Act 2024 s.259 (timing of reminder notices),
    https://www.legislation.gov.uk/ukpga/2024/13/section/259, primary (prospective).
65. CJEU press release 107/25, EDPS v SRB, C-413/23 P, 4 September 2025,
    https://curia.europa.eu/jcms/upload/docs/application/pdf/2025-09/cp250107en.pdf, primary (press release; judgment
    not opened).
66. IAPP, "EU member states finalize Digital Omnibus negotiating stance", 22 October 2026,
    https://iapp.org/news/a/eu-member-states-finalize-digital-omnibus-negotiating-stance, secondary.
67. iubenda, "The new online withdrawal function: what EU Directive 2023/2673 means for your business",
    https://www.iubenda.com/en/blog/the-new-online-withdrawal-function-what-eu-directive-2023-2673-means-for-your-business/,
    secondary (superseded by [72]).
68. Paddle Refund Policy (31 March 2026), https://www.paddle.com/legal/refund-policy, primary (third-party terms; what it
    says, not proof that the portal does it). Sections 1.1, 1.2, 1.6, 2.1, 2.2, 3.1, 3.5, 7.1. Pass 5.
69. Paddle seller terms (Master Services Agreement, 6 October 2026), https://www.paddle.com/legal/terms, primary (third-party
    terms). Clauses 2.1, 2.2, 4.1, 9.1, 9.3, 9.4, 9.6, 10.1, 10.2, 10.4, 11.1, 11.2. Pass 5. Whether any signed agreement is in
    force or differs was not checked.
70. Paddle help, enhanced billing notifications, location list,
    https://www.paddle.com/help/manage/your-customers/enhanced-billing-notifications-location-list, primary (third-party
    help page; undated).
71. Paddle help, emails customers receive on Paddle Billing,
    https://www.paddle.com/help/manage/your-customers/which-emails-will-customers-receive-on-paddle-billing, primary
    (third-party help page; does not say whether the reminder carries a cancel link).
72. Directive (EU) 2023/2673, inserting Art 11a into Directive 2011/83/EU, https://eur-lex.europa.eu/eli/dir/2023/2673/oj/eng,
    primary. Last 3,973 characters not read.
73. Directive 2011/83/EU, consolidated 28 May 2022, https://eur-lex.europa.eu/eli/dir/2011/83/2022-05-28/eng, primary.
    Does not yet show Art 11a. Arts 2(2), 13(8), 14(2a), 14(4)(b), 16(m).
74. EUR-Lex summary of consumer rights rules (last updated 21 November 2025),
    https://eur-lex.europa.eu/EN/legal-content/summary/consumer-information-right-of-withdrawal-and-other-consumer-rights.html,
    official summary; dated, used only to confirm the transposition and application dates.
75. Tiketa, C-536/20, judgment of 24 February 2022, https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62020CJ0536,
    primary. Ruling point 1, paras 28, 35, 36.
76. Digital Markets, Competition and Consumers Act 2024 s.225, https://www.legislation.gov.uk/ukpga/2024/13/section/225,
    primary.
77. Digital Markets, Competition and Consumers Act 2024 s.280, https://www.legislation.gov.uk/ukpga/2024/13/section/280,
    primary (prospective).
78. Digital Markets, Competition and Consumers Act 2024 s.254, https://www.legislation.gov.uk/ukpga/2024/13/section/254,
    primary (prospective).
79. Digital Markets, Competition and Consumers Act 2024 Sch 20, https://www.legislation.gov.uk/ukpga/2024/13/schedule/20,
    primary, pass 5 (paras 1 to 7).
80. CMA, Unfair commercial practices (CMA207),
    https://www.gov.uk/government/publications/unfair-commercial-practices-cma207/unfair-commercial-practices, regulator
    guidance. First 100,000 characters read.
81. CMA, Providing clear and accurate information about prices: summary (CMA209),
    https://www.gov.uk/government/publications/price-transparency-cma209/providing-clear-and-accurate-information-about-prices-summary,
    regulator guidance, pass 5. Full text now at [88].
82. Consumer Rights Act 2015 s.69, https://www.legislation.gov.uk/ukpga/2015/15/section/69, primary.
83. Freshfields, "Less than two months to go before tough new UK subscription rules bite", 2 November 2026,
    https://www.freshfields.com/en/our-thinking/blogs/risk-and-compliance/less-than-two-months-to-go-before-tough-new-uk-subscription-rules-bite-102o78a,
    secondary (used only for the laying date).
84. K&L Gates, "New EU Withdrawal Button Requirement", 8 July 2026,
    https://www.klgates.com/New-EU-Withdrawal-Button-Requirement-Practical-Implications-and-Recommendations-for-US-and-Global-Online-Sellers-7-8-2026,
    secondary.
85. npm registry metadata, https://registry.npmjs.org/@semics-tech/emdash-esign-pro (pass 5: `latest` is the deprecated
    0.0.0-bootstrap.0; `rc` is 1.0.0-rc.4) and https://registry.npmjs.org/@semics-tech/emdash-events-pro; LICENSE files through
    the jsDelivr mirror, https://cdn.jsdelivr.net/npm/@semics-tech/emdash-esign-pro@1.0.0-rc.4/LICENSE (and rc.0 to rc.3,
    bootstrap; events-pro rc.1 and rc.4; events-pro rc.0, rc.2, rc.3 not opened). Primary (published packages, through a mirror).
86. legislation.gov.uk title search for 2026 UK statutory instruments, "consumer subscription", no results,
    https://www.legislation.gov.uk/uksi/2026?title=consumer%20subscription, primary, weak (a title search on one day), pass 5.
87. Digital Markets, Competition and Consumers Act 2024 s.226, https://www.legislation.gov.uk/ukpga/2024/13/section/226, primary.
88. CMA, Price transparency (CMA209), full guidance,
    https://assets.publishing.service.gov.uk/media/6a3a92e333bc5beefd3c47b0/CMA209_Unfair_commercial_practices__price_transparency_13.2.26__2_.pdf,
    regulator guidance. Read directly: contents, paras 1.1-1.4, 2.3-2.12, 3.1-3.6 and note 20, 5.42-5.50. Chapter 4 and the rest of
    chapter 5 not read.
89. Directive 2005/29/EC (Unfair Commercial Practices), https://eur-lex.europa.eu/eli/dir/2005/29/oj/eng, primary. Arts 2(i),
    7(4)(c). National implementation not surveyed.
90. Price Marking Order 2004: government guidance,
    https://www.gov.uk/government/publications/price-marking-order-2004-government-guidance/price-marking-order-2004-government-guidance,
    government guidance.
91. Paddle help, Understanding Paddle's Acceptable Use Policy,
    https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle, primary (third-party help page).
92. Paddle help, Domain Review, https://www.paddle.com/help/start/account-verification/what-is-domain-verification, primary
    (third-party help page).
93. Paddle developer docs, Refund or credit a transaction,
    https://developer.paddle.com/build/transactions/create-transaction-adjustments, primary (third-party docs).
94. Paddle API reference, List adjustments, https://developer.paddle.com/api-reference/adjustments/list-adjustments, primary
    (third-party docs).
95. Paddle developer docs, Localize prices, https://developer.paddle.com/build/products/offer-localized-pricing/, primary
    (third-party docs; does not state whether automatic conversion is on by default).
96. Paddle, FTC settlement FAQ, https://www.paddle.com/ftc-agreement-faq, secondary (a party's own account; the order not opened).
97. Paddle email to the owner, 26 October 2026, subject "Update on your Paddle account application for semics.co.uk". Primary, but
    NOT opened by this researcher: quoted from the coordinator's report, which read it directly, and `tasks/T156-legal-pass-4-fixes.md`.
    Reported categories: IT services or software development; digital content/marketplaces; vehicle checks and reports; crypto
    trading/signals; adult-only content/gambling; consulting or advisory. Offers an appeal or a new application. The lawyer should
    see the original.
