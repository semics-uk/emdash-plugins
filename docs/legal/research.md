# Legal research on the E-sign brief, Issue 2

> Not legal advice. Prepared by an AI research assistant on 2026-10-26 from brief Issue 2, for review by a qualified
> lawyer. Every view below is provisional.

Notes on method. Primary sources were opened before being cited; numbers in square brackets refer to the Sources list.
Sources 1 to 37 come from the first pass (against Issue 1) and still hold; they were not re-opened unless relied on for
something new. Sources 38 onwards are new. EUR-Lex and the Court of Justice's InfoCuria site again returned empty pages
to the research tool, so: the 2024/1183 amendment was read from a full-text copy of the Official Journal text on a
third-party site [38]; EU GDPR articles are cited from the "as adopted" EU text on legislation.gov.uk; and the Breyer
judgment itself still could not be opened (BAILII refused the request too), so Q7 still rests on the court's press
release [32], now with ICO guidance [60] for the UK. Texas case law was found only through a secondary source and is
labelled so. Question 17 was checked against `apps/site/pages.mjs` and the six live pages at
https://plugins.semics.co.uk, which match the source text word for word [61].

## Summary table

| Q | Topic | Provisional view (one line) | Confidence | Needs lawyer to decide |
| --- | --- | --- | --- | --- |
| 1 | US consent wording | ESIGN §7001(c) applies only where a law requires information to be given to a consumer in writing; the waiver signature itself usually does not trigger it | Medium | Which owner documents trigger §7001(c); whether to ship a disclosure option |
| 2 | UK/EU consent wording | Wording is not legally required in England and Wales; two statements are sound; add a privacy-notice link and a line on copies and retention | Medium (E&W), low (EU) | Final wording; Member State formalities |
| 3 | Proving the wording | Store the wording text (and the intent sentence) per version and print both on the certificate | Medium | Whether printing it is wanted |
| 4 | Retention periods | 7 years suits adult contracts in E&W; it is too short for minors' injury claims, which can run to 21 or later | Medium (E&W), low (EU/US) | A separate default for guardian envelopes |
| 5 | Name and IP for 7 years | Name is defensible; a full IP for 7 years is harder to justify | Medium | Truncated or no IP on the certificate |
| 6 | Certificate contents | Signer's and minor's names are needed; entered values are the weak point | Medium | Per-field "print on signed copy"; child's name |
| 7 | IP addresses | IPs are personal data; full IPs on a certificate shown to co-signers are the main problem | Medium | Full, truncated or none |
| 8 | Guardian signing, minors | In E&W and Germany negligence injury liability cannot be excluded by standard consumer terms at all; US states split (CA, OH allow parental releases in some settings; TX, CO case law and NJ do not) | Low | Statement of authority; whole-group mode |
| 9 | No external anchor | Enough for a simple signature; the verify sentence overstates slightly | Medium | Final certificate wording |
| 10 | Identity assurance | Email control is a fair basis for low-value documents if the limit is stated; "Identity check" overclaims | Medium | Wording on page and certificate |
| 11 | Notice to other adults | Site owner (controller) must give Art 14 notice, at the latest in the invitation email | Medium | Notice text; buyer's confirmation |
| 12 | Roles and contracts | Owner is controller; maker is neither for signing data, but is controller of licence-buyer data | Medium | Templates the maker supplies; support access |
| 13 | Subject requests | Partial erasure relying on Art 17(3)(e) is permitted if justified and explained; manual access handling is lawful | Medium | Justification text; export tool |
| 14 | Mail-scanner prefetch | No legal requirement for a view event; the label should say what it records | High | Whether to log link fetches separately |
| 15 | Excluded documents | Yes, warn; list headline categories, do not filter | High (warn), low (completeness) | List contents per region |
| 16 | Uploaded PDFs | Original plus incremental update is good evidence; a conspicuous link plus an explicit tick is a recognised US pattern, and requiring an open would strengthen it | Medium (format, US notice), low (UK/EU notice) | Whether "offered by link" is enough |
| 17 | Product site terms, refunds, privacy | Broadly sound plain-English drafts, but: the licence they rely on is a placeholder granting no rights; the fee cap cannot bind consumers for digital-content conformity; UK subscription rules apply from 1 January 2027; the privacy policy mislabels Paddle and lacks some Art 13 items; some statements do not match the code | Medium (UK), low (EU, US) | Liability cap for business buyers; who is the "trader" with Paddle as reseller; retention; EU representative |

## Changes since the last pass

- **Question 17 is new** and is researched in full (product site terms, refunds and privacy, checked against the code
  and the live pages).
- **Issue 2 corrections checked.** Four of the six corrections are fully applied; two are incomplete (§10 and §12), and
  four new points are listed under "Corrections to the brief".
- **eIDAS as amended by 2024/1183.** The amendment deletes Article 25(3) only; Article 25(1) and (2) and the
  Article 3(10) definition are unchanged [38]. The brief's use of Article 25(2) and Article 3(10) still holds.
- **Minors' waivers.** California, Ohio and Texas added to the US survey (now CA, CO, FL, NJ, NY, OH, TX); Germany added
  as an EU Member State (Q8).
- **US clickwrap notice.** Berman v. Freedom Financial Network (9th Cir. 2022) [43] added to Q16 and Q17.
- **Breyer.** The judgment text still could not be opened; ICO guidance on IP addresses added for the UK (Q7).
- Q1 to Q6 and Q9 to Q15 are unchanged in substance; wording has been tightened where Issue 2 changed the brief.

## Q1. Consent wording for the US

**Question.** Is the default consent sentence enough under ESIGN/UETA for consumers, and are §7001(c) disclosures needed?

**Law.** US: ESIGN gives electronic signatures and contracts legal effect [1, §7001(a)]. The §7001(c)(1) consumer-consent
procedure (prior statement of paper rights, withdrawal, scope, hardware and software, and a consent that reasonably
demonstrates access) applies only where a statute, regulation or rule of law requires information to be provided to a
consumer in writing [1]. A contract is not invalid solely because the (c)(1)(C)(ii) consent was not obtained [1,
§7001(c)(3)]. "Consumer" includes the individual's legal representative [3]. UETA applies only where the parties have
agreed to transact electronically, judged from context and conduct (UETA §5(b), as enacted in West Virginia [4]).

**Provisional view.** Issue 2's §2 now states this correctly. For the waiver or contract itself, there is usually no
law requiring information to be "provided in writing" to the signer, so §7001(c) is probably not triggered by the act
of signing, and the consent and intent boxes are good evidence of UETA §5(b) agreement. It is triggered where the
document carries a disclosure some law requires in writing. Example: Florida requires a specific, capitalised notice in
a parent's waiver for a minor [20]; whether that counts as information "provided" to a consumer in writing is unclear.

**Confidence and gaps.** Medium. No court decision on §7001(c) and waivers was found.

**Suggested change, if any.** An optional "US consumer disclosure" setting covering the §7001(c)(1)(B) items, shown
before signing, with a confirmation that the signer could open the document in this form.

**For the lawyer.** Which of the owners' likely documents carry legally required written disclosures, and whether the
disclosure option should be on by default for US sites.

## Q2. Consent wording for UK/EU consumers

**Question.** Is the wording sufficient in the UK/EU, should it say more, and should consent and intent stay separate?

**Law.** UK: an electronic signature may not be denied legal effect or admissibility solely because it is electronic
[7]; electronic signatures are admissible on authenticity [6]. The Law Commission states an electronic signature can
execute a document if the signer intends to authenticate it and any formalities are met, and notes courts have accepted
an "I accept" tick box [11]. Art 13 requires the controller to give, at collection, its identity, purposes, recipients
and retention period, among other things [28a]. EU: Art 25(1) is the same and survives the 2024/1183 amendment
unchanged [8][38]; recital 49 leaves the effect of non-qualified signatures to national law [9].

**Provisional view.** English law does not require a separate consent to the electronic medium; the decisive element is
intent to authenticate, which the second box captures. Two statements are sound: they separate agreement to the medium
from intent to sign and mirror ESIGN/UETA. The wording need not say more for validity, but the page collects personal
data (name, IP, user agent, entered values), so Art 13 information must be available at that moment; the brief still
describes no privacy-notice link on the page.

**Confidence and gaps.** Medium for England and Wales; low for the EU (national effect; only Germany's standard-terms
rule was opened this pass, for Q8).

**Suggested change, if any.** A setting for the owner's privacy-notice URL, linked beside the tick boxes, and an optional
line such as "You will be emailed a link to the signed copy. [Owner] keeps the signed record for [N] years."

**For the lawyer.** Final wording, and whether any target Member State requires more for consumer contracts.

## Q3. Proving the wording later

**Question.** Should the consent text be stored per signature or printed on the certificate?

**Law.** UK: the party relying on a signature must prove what was signed and the intent to authenticate [11]. US: where
law requires a writing, a record may be denied effect if it cannot be retained and accurately reproduced [1, §7001(e)];
retention is satisfied by an accurate, accessible, reproducible record [1, §7001(d)].

**Provisional view.** A hash proves the text only if someone can later produce the matching text. Relying on the owner
to archive every wording is a weak link, and the intent sentence is not hashed at all. The wording is not personal data,
so storing it costs nothing in data protection terms.

**Confidence and gaps.** Medium. An evidential judgement; no authority speaks to consent-wording hashes.

**Suggested change, if any.** Store each wording version immutably (keyed by its hash), print the consent wording and
the intent sentence on the certificate, and hash the intent sentence too.

**For the lawyer.** Whether printing both sentences on the certificate is desirable (provisionally, yes).

## Q4. Retention periods

**Question.** Are 12 months and 7 years good defaults, especially for minors' waivers?

**Law.** England and Wales: simple contract, 6 years from accrual [12]. Personal injury, 3 years from the later of
accrual and the date of knowledge [13]. A minor is under a disability [16]; for personal injury the 3 years run from
when the disability ends [14, s.28(1), (6)]. The court may disapply the time limits where equitable [15]. ICO:
retention must be justified; keeping data to defend possible claims is legitimate, "just in case" is not [33]. US: New
York extends limitation for infancy to three years after it ends, generally capped at ten years from accrual [25];
other states' limitation rules not checked. EU: not surveyed.

**Provisional view.** Issue 2's question 4 now states the E&W rules correctly. 7 years fits adult contracts in
England and Wales (6 years plus a margin). It does not cover a minor's injury claim: a child injured at 5 can sue until
21, and s.33 can extend that. A UK consumer waiver cannot exclude negligence liability for injury (Q8), so the record's
value is chiefly as evidence of warnings and parental agreement to take part, which still matters in a claim. 12 months
for separate copies is defensible because the signed record remains.

**Confidence and gaps.** Medium for England and Wales; low for the EU and the US.

**Suggested change, if any.** A separate records period for envelopes with a guardian signer (for example 21 years, or
"until the participant would be 21, plus one year" if a birth year were collected).

**For the lawyer.** The guardian-envelope default.

## Q5. Name and IP kept for 7 years inside the PDF

**Question.** Is keeping name and IP inside the signed record for the records period defensible?

**Law.** UK/EU: data must be limited to what is necessary and kept identifiable no longer than necessary [27, Art
5(1)(c), (e)]. ICO: retention to defend possible claims is legitimate if justified [33]. Erasure does not apply where
processing is necessary for legal claims [30, Art 17(3)(e)].

**Provisional view.** The signer's name is defensible: a signed record without it proves little. Full IP addresses are
harder. They help attribution, but their weight is modest without ISP records, and after 12 months the salt is deleted,
so the printed IP can no longer be checked against the chain (only against the whole-PDF hash). Keeping a full IP for
7 years "because it is in the PDF" is a design consequence, not a purpose.

**Confidence and gaps.** Medium. No regulator guidance on e-signature certificates specifically was found.

**Suggested change, if any.** A setting for IP on the certificate: full, truncated (for example /24 or /48), or none,
with the full IP kept in the database until the personal-data purge.

**For the lawyer.** Which default, and confirmation that the owner's privacy notice must say that name and IP stay in
the signed record for the records period (Art 13(2)(a) [28a]).

## Q6. Certificate contents and data minimisation

**Question.** Which certificate items are necessary, and should a child's name be kept for 7 years?

**Law.** Art 5(1)(c) [27]. Children merit specific protection [31, recital 38]. Art 17(3)(e) [30].

**Provisional view.** Signer name: necessary. Minor's name: probably necessary, because without it a guardian waiver
does not say which child it covers; keep it but print nothing else about the child. Capacity, hashes, consent version
and times: necessary and low risk. Entered values are the weak point: an emergency contact is a third party's data
needed only for the event, and owners may ask for medical details, which may be special category data (Art 9; not
researched). Because the signature hash binds entered values, they can be left off the PDF and still be proved while
the database copy exists.

**Confidence and gaps.** Medium.

**Suggested change, if any.** A per-field choice in the template: "print on the signed copy" (terms the signer agreed
to) or "operational only" (removed at the personal-data purge, not printed).

**For the lawyer.** Whether operational-only should be the default for new fields; confirmation on the child's name.

## Q7. IP addresses

**Question.** Should IP addresses appear on the certificate, in full, truncated or not at all?

**Law.** EU: a dynamic IP address is personal data for a website operator that has legal means to identify the visitor
with the ISP's information (CJEU, Breyer, C-582/14, 19 October 2016, press release [32]; judgment text still not
opened). UK/EU: "online identifier" is in the definition of personal data [26]; recital 30 names IP addresses [31]. ICO:
lists IP addresses among online identifiers, and says identifiability is judged on the identifiers "on their own or in
combination with other information" available [60]. US: no comparable rule found.

**Provisional view.** IPs are personal data in the UK and EU. The strongest point is one the brief does not raise: in a
several-signer envelope every signer receives a certificate showing every other signer's IP addresses (and names and
entered values). That is a disclosure of each signer's data to the others, which needs a purpose; for IPs it is hard to
find one. A truncated IP keeps some evidential use with much less identifiability.

**Confidence and gaps.** Medium. The evidential weight of IPs in English courts was not researched.

**Suggested change, if any.** Default the certificate to truncated IPs (or none), keep full IPs in the database until
the personal-data purge, and in several-signer envelopes avoid printing other signers' full IPs.

**For the lawyer.** Default setting, and whether co-signers may see each other's entered values.

## Q8. Guardian signing for minors

**Question.** Is guardian signing on the buyer's word reasonable, are minors' waivers enforceable, and should the
whole-group mode exist?

**Law.** England and Wales: a trader cannot exclude or restrict liability for death or personal injury from negligence
by a consumer term or notice [17]; the same applies to business liability generally [18]. EU: such a term is
indicatively unfair [19]. Germany: in standard business terms, any exclusion or limitation of liability "for damage
from injury to life, limb or health" caused by negligent breach is ineffective (BGB §309 no. 7(a)), and a minor needs
the legal representative's consent for transactions not merely to the minor's legal benefit (§107) [42]. US (states
checked: CA, CO, FL, NJ, NY, OH, TX): California courts have enforced parents' releases of ordinary negligence, which
the state Supreme Court called "apparently ... a minority view", and it held releases of future gross negligence
unenforceable [40]. Ohio's Supreme Court let parents bind children to releases for "volunteers and sponsors of
nonprofit sport activities" [39]. Texas: an appellate court held parents cannot waive a child's injury claim (Munoz v.
II Jaz, 1993), and a federal court predicted the same for a commercial gym (Paz, 2010); both via a secondary source
[41]. Colorado allows it by statute except for wilful, wanton, reckless or grossly negligent conduct [21][22]; Florida
only for inherent risks with a mandatory notice [20]; New Jersey refuses it at commercial facilities [23]; New York
voids negligence waivers at paid recreational facilities for everyone [24].

**Provisional view.** In England and Wales and Germany parental authority is largely moot for negligence injury claims,
because no standard-terms waiver can exclude that liability, even an adult's. In the US the answer depends on the state
and on whether the provider is commercial. Recording the buyer's assertion is reasonable if the buyer makes an explicit
statement. The whole-group mode records one adult's agreement only and, provisionally, should not be offered for adults.

**Confidence and gaps.** Low. Texas rests on a secondary source; the Ohio commercial-provider position and other states
were not checked; other Member States not surveyed.

**Suggested change, if any.** A required, hashed statement for guardian signing ("I am the parent or legal guardian of
[participant] and have authority to sign for them"). Allow Florida-style formatted notices in templates.

**For the lawyer.** Whether to drop whole-group mode for adults; which US states owners will use.

## Q9. Tamper evidence without an external anchor

**Question.** Is an internal hash chain enough for a simple signature, and is the certificate wording fair?

**Law.** UK/EU: an electronic signature is "data in electronic form which is attached to or logically associated with"
other data and used to sign [10]; no integrity mechanism is required for a simple signature [7][8][38]. Admissibility on
integrity [6]. US: copies can be self-authenticated by matching hash values under a qualified person's certification
[37, FRE 902(14)].

**Provisional view.** No law requires an external anchor for a simple signature; the chain and final hash are better
than most simple signatures offer. "Anyone holding this PDF can check these values on the verify page" overstates a
little: the check works only while the site keeps the record, and it proves consistency with the site's own database,
not independent integrity.

**Confidence and gaps.** Medium.

**Suggested change, if any.** For example: "While [site] keeps this record, anyone holding this PDF can check on the
verify page that it matches. The record is held by [site]; no independent timestamp is used."

**For the lawyer.** Final wording, and whether "not matched" after deletion should say "no record held".

## Q10. Identity assurance

**Question.** Is email-inbox control fair for waivers and low-value agreements, and is the OTP wording fair?

**Law.** US: a signature is attributable to a person if it was their act, shown in any manner, including the efficacy
of a security procedure (UETA §9 as enacted [5]). UK: electronic signatures are admissible on identity; there is no
prescribed form [11][6].

**Provisional view.** Email control is the market norm for low-value documents and is fair if the product does not
imply more. Two points: inline signing (Events at the booking screen) involves no email control at all, so the
certificate should say how the signer reached the page; and the "Identity check" label, which Issue 2 now names,
overclaims, as §6 of the brief itself says the code is not identity verification.

**Confidence and gaps.** Medium.

**Suggested change, if any.** A certificate line such as "Signer's identity not verified. Access: link emailed to
[masked address]" or "signed on the site's page during booking"; rename the row "Email access check: one-time code sent
to [masked address] entered at [time]".

**For the lawyer.** Whether the ceremony page should also tell the signer their identity is not verified.

## Q11. Notice to other adults

**Question.** Who gives privacy notice to attendees whose emails the buyer enters, and what should the invitation say?

**Law.** UK/EU: where data are not obtained from the data subject, the controller must give Art 14 information, and
where the data are used to communicate with the person, at the latest at the first communication [28]. The
disproportionate-effort exemption is unlikely to fit when the controller is emailing the person anyway [28].

**Provisional view.** The site owner, as controller, must give notice, and the invitation email is the natural place:
who is asking, that the buyer supplied the address, the purpose, and a link to the full privacy notice. The 10-per-
booking cap is an abuse control; a signing invitation is probably not direct marketing (not researched).

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

**Provisional view.** The site owner is the controller of signing data. The maker, supplying self-hosted software with
no access, is probably neither controller nor processor of it. Issue 2's §10 now says the maker controls licence-buyer
data; see the corrections below for what the licence service actually holds. Selling licences to EU buyers may bring
the maker within EU GDPR and Art 27 (see Q17).

**Confidence and gaps.** Medium.

**Suggested change, if any.** Supply owners with a privacy-notice template for signers (Art 13/14 items), a record of
processing template, and a note on DPIAs for children's waivers. A DPA only if the maker ever gets access.

**For the lawyer.** Whether support access to an owner's site would make the maker a processor, and terms for that.

## Q13. Subject requests

**Question.** Is admin-run erasure that keeps the signed record acceptable, and is manual access handling enough?

**Law.** Art 17(3)(e) excepts processing necessary for legal claims [30]. ICO: a request may be refused wholly or
partly; the controller must say why within one month and explain remedies [34]. Art 15: access and a copy, limited to a
reasonable and proportionate search [29]. From 19 June 2026 controllers must facilitate complaints (for example a form
that can be completed electronically) and acknowledge them within 30 days [57].

**Provisional view.** Partial erasure is lawful if the owner can justify keeping the signed record for a plausible claim
within the limitation period and tells the person what was kept and why. Manual access handling is lawful, but data sit
in several places (signer record, audit events, PDF, outbox), which is error-prone within one month.

**Confidence and gaps.** Medium.

**Suggested change, if any.** After erasure, show the admin a short summary to send the requester (what was deleted,
what remains, until when, and why). Consider an export of one signer's data.

**For the lawyer.** The standard justification text, and a complaints-handling note for owners (s.164A [57]).

## Q14. Mail-scanner prefetch

**Question.** Is a view recorded only at first submit still meaningful, and should the certificate say so?

**Law.** No law found requires a "viewed" event for a simple signature under ESIGN, UETA or eIDAS [1][7][8].

**Provisional view.** The event means "a person had the page open and submitted it", which adds little to the consent
and signature events at the same moment. Calling it "viewed" invites the reading that the time is when the signer first
opened the document, which is wrong. Not trusting GETs is sound.

**Confidence and gaps.** High that the label should match the behaviour; there is no authority either way.

**Suggested change, if any.** Label it "Opened and submitted", or add: "Page loads are not recorded because email
scanners open links automatically."

**For the lawyer.** Whether to record page loads separately as "link fetched (may be automated)".

## Q15. Excluded document types

**Question.** Should the product warn owners about documents that cannot be signed this way?

**Law.** US: ESIGN excludes wills and testamentary trusts, family-law matters, most of the UCC, court documents and
certain notices (utility cut-off, foreclosure or eviction of a primary residence, insurance cancellation, product
recalls, hazardous-materials documents) [2]; UETA excludes wills and most of the UCC [4a]. England and Wales: deeds that
must be witnessed need the witness physically present [11]. EU: legal effect is for national law [9].

**Provisional view.** Yes. A short warning in the template editor and operator guide, naming headline categories per
region and telling owners to take advice, is cheap and reduces misuse. Automatic filtering is not feasible.

**Confidence and gaps.** High that a warning is prudent; low on completeness (UK wills and land formalities and EU
national exclusions not opened).

**Suggested change, if any.** Warning text with a link to a docs page listing the categories above.

**For the lawyer.** The list for England and Wales and the main EU states.

## Q16. Uploaded PDFs

**Question.** Is original-plus-incremental-update good evidence, and is offering the PDF by link enough?

**Law.** US: records must be accurately reproducible [1, §7001(d), (e)]; hash matching authenticates copies [37]. On
notice, the Ninth Circuit binds a user to online terms only if (1) the site gives "reasonably conspicuous notice" of
them and (2) the user takes an action, such as ticking a box, that "unambiguously manifests" assent; a link must look
like one (contrasting colour, typically blue), and the user must be told explicitly what action means agreement;
clickwrap with an explicit "I agree" box is routinely enforced (Berman, citing Nguyen and the Second Circuit's Meyer v.
Uber) [43]. UK: admissibility on integrity [6]. No authority on PDF structure was found.

**Provisional view.** Keeping the original bytes and appending an update is arguably better evidence than flattening,
because anyone can cut the file back and match `docSha256`; flattening would destroy that check. Later appended
updates are caught by `pdfSha256` and `/verify`. On display, Berman suggests a US court would accept a document offered
by a clearly styled link if the signer ticks a box saying they agree to that document; it is not required that the
signer actually opened it. Requiring an open before signing goes beyond that and would make the record stronger. English
and EU incorporation rules were not researched.

**Confidence and gaps.** Medium on format and the US notice point; low for the UK and EU.

**Suggested change, if any.** Style the open and download links as links; add the file name to the consent or intent
sentence ("...to my signature on [file name]"); optionally require an open (recorded as a page action, not a fetch).

**For the lawyer.** Whether "offered by link" plus an explicit tick is enough notice in England and Wales.

## Q17. The product site's terms, refund and privacy text

**Question.** Are the terms of sale, refund policy and privacy policy at plugins.semics.co.uk fit for launch?

**Law.** Contract structure: Paddle's buyer terms make Paddle the reseller, say the supplier's own terms govern use of
the product, exclude Paddle's liability for the product, give UK/EU consumers a 14-day withdrawal right (lost once they
use the product after agreeing to immediate supply), and say Paddle sends renewal reminders where law requires [52].
UK consumers: digital-content terms cannot exclude or restrict liability under CRA ss.34-37 and 41, including by
restrictive conditions on remedies [48]; terms limiting a consumer's rights inappropriately are on the grey list [49];
the right to cancel digital content can be lost on express consent and acknowledgement [44]. Business buyers: caps must
be reasonable, judged partly on resources and insurance [50]. From 1 January 2027 (subject to approval of draft
regulations laid in October 2026 [47]) consumer subscriptions need key pre-contract information, reminder notices
(including an extra one before 12-month renewals), easy online exit, and a 14-day renewal cooling-off period after each
annual renewal and after any discounted period [46]. Invitations to purchase must give the total price including
taxes, or how it is calculated, as prominently as the price [45]. Choice of law cannot remove a consumer's home-law
protection [51]. Websites must show registered number, part of UK and registered office [54]. Privacy: Art 13 [28a];
Paddle describes itself as a controller [53]; accounting records 3 years (Companies Act) [55], HMRC 6 years [56];
complaints duty [57]; EU GDPR Art 3(2) and 27 [58][59].

**Provisional view.**
- **The licence the terms rely on grants nothing.** The terms grant use "under the licence that comes with the Pro
  package". That file in both public Pro packages is a placeholder saying no right to use is granted. This must be
  replaced before any sale; the name ("Semics") should also match SEMICS LTD.
- **Liability.** For UK consumers, the fee cap and loss exclusions cannot bind as to digital-content quality,
  description and fitness [48]; the saving sentence helps, but a general saving clause may not cure a lack of
  transparency. Whether SEMICS is the "trader" when Paddle sells is unclear. For business buyers (most buyers), a cap at
  one year's fee is common in software, but a signing failure could cost an owner far more; reasonableness is fact-based.
- **Refunds.** A 14-day no-questions refund on purchase and renewal is more generous than the law and Paddle require,
  and already exceeds the 2027 renewal cooling-off. BUILD-PLAN D6 says 30 days; one must change.
- **Renewal.** For UK consumers from 2027, confirm Paddle sends the required reminders and exit route, and that D5's
  first-year discount triggers the renewal cooling-off and specific reminders.
- **Prices.** "Before tax", stated below the prices, may not meet the total-price rule for UK consumers once buy links
  go live [45].
- **Accuracy.** "When a licence ends, Pro features stop taking new work" and the refund page's similar sentence do not
  match the code: an issued key keeps verifying offline, also after a refund, and old versions keep working.
- **Privacy.** Mostly complete and accurate (the site sets no cookies and runs no scripts; checked). Gaps: Paddle is
  listed as a processor but is a controller; no legal basis for website logs or support email (legitimate interests);
  portability and objection not mentioned; 6-year retention is justified by HMRC and the 6-year contract limitation
  [12][56], but the licence Worker has no deletion job, and its Paddle event log has no period at all.
- **Law clause and disclosures.** Consistent with Rome I Art 6 [51]; company details appear on terms and contact [54].

**Confidence and gaps.** Medium for UK consumer and privacy points; low for EU national law and US state law (for
example California's automatic-renewal law, not researched). The draft 2027 regulations may change before approval.

**Suggested change, if any.** Publish the real Pro licence; add "plus VAT or sales tax where it applies" beside each
price; fix the two licence-end sentences; move Paddle to "independent controller"; add legal bases, portability and
objection; build the retention job.

**For the lawyer.** The cap for business buyers; who the "trader" is under Paddle; whether SEMICS needs an EU
representative under Art 27 [58] or meets the occasional-processing exemption; the refund period (14 or 30 days).

## Corrections to the brief

Status of the six corrections from the first pass, as applied in Issue 2:

1. §2, ESIGN §7001(c) scope and the pointer to question 1: **applied correctly.**
2. §2 "not built yet" and §12's reviewed-code bullet: **partly applied.** §2 is fixed. §12's last bullet still says
   only the email one-time code was reviewed as Pro code, but [C34] relies on Pro routing and [C36] cites Pro repository
   files for §5.6 (`packages/esign-pro/src/domain/pdf-templates.ts`, `src/pdf/update.ts`). Say which Pro code was read
   for §5.5 and §5.6.
3. "Simple" signature not an eIDAS term: **applied correctly.** It remains right after 2024/1183, which changes neither
   Article 3(10) nor Article 25(1) and (2) [38].
4. §10, licence service: **partly applied.** §10 says the service "receives Pro buyers' names and email addresses".
   The licence Worker's database (`emdash-plugins-pro/packages/licence-worker/migrations/0001_init.sql`) stores email,
   hostnames, Paddle customer, transaction and subscription ids, the plan, the key and its dates, but no name; the
   privacy policy says the same. §10 also omits the maker's own vendors (Cloudflare Workers, D1 and Email Service, R87;
   Paddle) and the hostnames.
5. Question 4, limitation for minors: **applied correctly.**
6. "Identity check" label: **applied correctly** (§6 and question 10).

New points in Issue 2:

7. §14 lists question 17 among additions to Issue 1 "before review", but the first research pass did not cover it; it
   is new matter for this review and belongs in Issue 2's change list.
8. Question 17 says the Pro licence is "still a placeholder in the Pro repo". Accurate, but it understates the risk:
   per R85 the placeholder ships in the public npm packages, says no right to use is granted, and is the licence the
   terms point buyers to.
9. Question 17 does not mention that BUILD-PLAN D6 promises a 30-day refund while the site (and R88) say 14 days, or
   that D5's first-year discount is not on the pricing page.
10. Question 17 does not mention that the site's statements on licence end and refund do not match the licence code
    (`licence-worker/src/handlers.ts` header: an issued key "can never be switched off remotely").

## Also noticed

- **Waivers cannot exclude negligence injury liability in the UK** [17][18] or, in standard terms, in Germany [42], and
  such terms are indicatively unfair in the EU [19]. Operator docs should say this plainly.
- **Co-signers see each other's data.** Every signer's copy prints every signer's name, IP and entered values (Q7).
- **No privacy-notice link on the signing page**, although it collects personal data (Q2, Art 13 [28a]).
- **Florida-style statutory notices** need capitalised text at least 5 points larger [20]; templates should allow it.
- **International transfers.** Hosting on a US provider may be a restricted transfer for UK/EU owners; not researched.
- **Maker's EU exposure.** Selling licences to EU buyers may bring SEMICS LTD within EU GDPR and its representative
  duty (Q12, Q17).
- **Pro licence name.** The placeholder licence names "Semics", not the contracting company SEMICS LTD.

## Sources

All accessed 2026-10-26. Sources 1 to 37 were opened in the first pass and are kept; 38 onwards are new.

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
32. CJEU press release 112/16, Breyer v Bundesrepublik Deutschland, C-582/14,
    https://curia.europa.eu/jcms/upload/docs/application/pdf/2016-10/cp160112en.pdf, primary (court press release; the
    judgment could not be opened on EUR-Lex, InfoCuria or BAILII).
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
38. Regulation (EU) 2024/1183 amending Regulation (EU) No 910/2014, Art 1 point (23) ("in Article 25, paragraph 3 is
    deleted"), full Official Journal text as reproduced at https://lawplayer.com/eu/act/32024R1183, primary text via a
    third-party copy (EUR-Lex not reachable; confirm against
    https://eur-lex.europa.eu/eli/reg/2024/1183/oj).
39. Zivich v. Mentor Soccer Club, Inc., 82 Ohio St.3d 367 (1998), https://caselaw.findlaw.com/oh-supreme-court/1375990.html,
    primary.
40. City of Santa Barbara v. Superior Court (Janeway), 41 Cal.4th 747 (2007),
    https://scocal.stanford.edu/opinion/santa-barbara-v-super-ct-33759, primary.
41. T. Dowell, "Will Texas courts enforce liability waivers signed on behalf of minor children?", Texas Agriculture Law
    blog, Texas A&M AgriLife, 20 January 2020,
    https://agrilife.org/texasaglaw/2020/01/20/will-texas-courts-enforce-liability-waivers-signed-on-behalf-of-minor-children/,
    secondary (Munoz v. II Jaz Inc., 863 S.W.2d 207 (Tex. App. 1993) and Paz v. Life Time Fitness, 757 F. Supp. 2d 658
    (S.D. Tex. 2010) not opened).
42. German Civil Code (BGB) §§107, 309, English translation,
    https://www.gesetze-im-internet.de/englisch_bgb/englisch_bgb.html, primary (translation on the Federal Ministry of
    Justice site; not an official text).
43. Berman v. Freedom Financial Network, LLC, 30 F.4th 849 (9th Cir. 2022),
    https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/05/20-16900.pdf, primary.
44. Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 reg 37,
    https://www.legislation.gov.uk/uksi/2013/3134/regulation/37, primary.
45. Digital Markets, Competition and Consumers Act 2024 s.230,
    https://www.legislation.gov.uk/ukpga/2024/13/section/230, primary.
46. Department for Business and Trade, Draft guidance on the Draft Consumer Subscription Contracts (Cancellation and
    Information) Regulations 2026, October 2026,
    https://assets.publishing.service.gov.uk/media/6acf97da2de3184ccf8b814e/subscription-contracts-rules-guidance.pdf,
    government guidance (draft).
47. Wiggin LLP, Digital Markets, Competition and Consumers Act tracker,
    https://www.wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/, secondary (commencement and
    laying of the draft regulations).
48. Consumer Rights Act 2015 s.47, https://www.legislation.gov.uk/ukpga/2015/15/section/47, primary.
49. Consumer Rights Act 2015 Sch 2, https://www.legislation.gov.uk/ukpga/2015/15/schedule/2, primary.
50. Unfair Contract Terms Act 1977 s.11, https://www.legislation.gov.uk/ukpga/1977/50/section/11, primary.
51. Rome I Regulation Art 6 (UK retained version), https://www.legislation.gov.uk/eur/2008/593/article/6, primary.
52. Paddle Buyer Terms (31 March 2026), https://www.paddle.com/legal/checkout-buyer-terms, primary (third-party terms).
53. Paddle Privacy Notice (16 March 2026), https://www.paddle.com/legal/privacy, primary (third-party notice).
54. Company, Limited Liability Partnership and Business (Names and Trading Disclosures) Regulations 2015 reg 25,
    https://www.legislation.gov.uk/uksi/2015/17/regulation/25, primary.
55. Companies Act 2006 s.388, https://www.legislation.gov.uk/ukpga/2006/46/section/388, primary.
56. GOV.UK, Running a limited company: company and accounting records,
    https://www.gov.uk/running-a-limited-company/company-and-accounting-records, government guidance.
57. Data Protection Act 2018 s.164A, https://www.legislation.gov.uk/ukpga/2018/12/section/164A, primary.
58. EU GDPR Art 27 as adopted, https://www.legislation.gov.uk/eur/2016/679/article/27/adopted, primary.
59. EU GDPR Art 3 as adopted, https://www.legislation.gov.uk/eur/2016/679/article/3/adopted, primary.
60. ICO, What are identifiers and related factors?,
    https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/what-are-identifiers-and-related-factors/,
    regulator guidance.
61. plugins.semics.co.uk, pages /, /pricing, /terms, /refunds, /privacy and /contact, fetched 2026-10-26, compared with
    `apps/site/pages.mjs` (text identical), primary (the text under review). Internal files also read:
    `emdash-plugins-pro/packages/{esign-pro,events-pro}/LICENSE`, `emdash-plugins-pro/packages/licence-worker/migrations/0001_init.sql`
    and `src/handlers.ts`, `apps/docs/pages/editions.md`, BUILD-PLAN D5, D6, R85, R87 and R88.
