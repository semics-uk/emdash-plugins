# Legal research on the E-sign brief

> Not legal advice. Prepared by an AI research assistant on 2026-10-26 from brief Issue 1, for review by a qualified
> lawyer. Every view below is provisional.

Notes on method. Primary sources were opened before being cited; numbers in square brackets refer to the Sources list.
EUR-Lex returned empty pages to the research tool, so EU legislation is cited from the "as adopted" EU text that
legislation.gov.uk keeps, and the EU GDPR is assumed to match the UK GDPR article numbers cited. The 2024/1183 amendment
to eIDAS was not opened; the lawyer should confirm it leaves Article 25 unchanged. Where a case was found only through
a secondary source, it is labelled so. No EU Member State's national law was surveyed.

## Summary table

| Q | Topic | Provisional view (one line) | Confidence | Needs lawyer to decide |
| --- | --- | --- | --- | --- |
| 1 | US consent wording | ESIGN §7001(c) disclosures apply only where a law requires information to be given to a consumer in writing; the waiver signature itself usually does not trigger them | Medium | Which owner documents (for example statutory waiver notices) do trigger §7001(c), and whether to ship a disclosure option |
| 2 | UK/EU consent wording | Wording is not legally required in England and Wales; two statements are sound; add a link to the owner's privacy notice and a line on copies and retention | Medium (E&W), low (EU) | Final wording; Member State formalities |
| 3 | Proving the wording | Store the wording text (and the intent sentence) per version and print it on the certificate | Medium | Whether printing it is wanted |
| 4 | Retention periods | 7 years suits adult contracts in E&W; it is too short for minors' claims, which can run to age 21 or later | Medium (E&W), low (EU/US) | A separate default for guardian envelopes |
| 5 | Name and IP for 7 years | Name is defensible; keeping full IP for 7 years is harder to justify | Medium | Whether to offer truncated or no IP on the certificate |
| 6 | Certificate contents | Signer and minor's name are needed; entered values (contacts, health) are the weak point | Medium | Per-field "print on signed copy" choice; child's name |
| 7 | IP addresses | IPs are personal data; full IP on a certificate given to co-signers is the main problem | Medium | Full, truncated or none on the certificate |
| 8 | Guardian signing, minors | In E&W negligence liability for injury cannot be excluded against consumers at all; US states split | Low | Statement of authority; whether to offer the whole-group mode |
| 9 | No external anchor | Enough for a simple signature; the certificate's verify sentence overstates slightly | Medium | Final certificate wording |
| 10 | Identity assurance | Email control is a fair basis for low-value documents if the limit is stated; "Identity check" label overclaims | Medium | Wording on page and certificate |
| 11 | Notice to other adults | Site owner (controller) must give Art 14 notice at the latest in the invitation email | Medium | Notice text; whether 10 per booking is enough |
| 12 | Roles and contracts | Owner is controller; maker is neither for signing data, but is controller for licence buyer data | Medium | Terms and templates the maker supplies |
| 13 | Subject requests | Partial erasure relying on Art 17(3)(e) is permitted if justified and explained; manual access handling is lawful | Medium | Justification text; whether an export tool is needed |
| 14 | Mail-scanner prefetch | No legal requirement for a view event; the label "viewed" should say what it records | High | Whether to log link fetches separately |
| 15 | Excluded documents | Yes, warn; list headline categories, do not try to filter | High (warn), low (completeness) | List contents per region |
| 16 | Uploaded PDFs | Original plus incremental update is good evidence, arguably better than flattening; consider requiring an open before signing | Low | Whether "offered by link" is enough notice |

## Q1. Consent wording for the US

**Question.** Is the default consent sentence enough under ESIGN/UETA for consumers, and are §7001(c) disclosures needed?

**Law.** US: ESIGN gives electronic signatures and contracts legal effect [1, §7001(a)]. The §7001(c)(1) consumer-consent
procedure (prior statement of paper rights, withdrawal, scope, hardware and software, and a consent that reasonably
demonstrates access) applies only where a statute, regulation or rule of law requires information to be provided to a
consumer in writing [1]. A contract is not invalid solely because the (c)(1)(C)(ii) consent was not obtained [1,
§7001(c)(3)]. "Consumer" includes the individual's legal representative [3]. UETA applies only where the parties have
agreed to transact electronically, judged from context and conduct (UETA §5(b), as enacted in West Virginia [4]).

**Provisional view.** For the waiver or contract itself, there is usually no law requiring information to be "provided
in writing" to the signer, so §7001(c) is probably not triggered by the act of signing, and the consent and intent
boxes are good evidence of UETA §5(b) agreement. §7001(c) is triggered where the document carries a disclosure that some
law requires in writing. Example: Florida requires a specific, capitalised notice in a parent's waiver for a minor [20];
whether that counts as information "provided" to a consumer in writing is unclear. It is also triggered if the owner
later delivers legally required notices electronically.

**Confidence and gaps.** Medium. No court decision on §7001(c) and waivers was found.

**Suggested change, if any.** An optional "US consumer disclosure" setting: a template covering the §7001(c)(1)(B)
items, shown before signing, and a confirmation that the signer could open the document in this form.

**For the lawyer.** Which of the owners' likely documents carry legally required written disclosures, and whether the
disclosure option should be on by default for US sites.

## Q2. Consent wording for UK/EU consumers

**Question.** Is the wording sufficient in the UK/EU, should it say more, and should consent and intent stay separate?

**Law.** UK: an electronic signature may not be denied legal effect or admissibility solely because it is electronic
[7]; electronic signatures are admissible on authenticity [6]. The Law Commission states an electronic signature can
execute a document if the signer intends to authenticate it and any formalities are met, and notes courts have accepted
an "I accept" tick box [11]. Transparency: Art 13 requires the controller to tell the person, at collection, among other
things its identity, purposes, recipients and retention period [28a]. EU: Art 25(1) is the same [8]; recital 49 leaves
the legal effect of non-qualified signatures to national law [9].

**Provisional view.** English law does not require a separate consent to the electronic medium; the decisive element is
intent to authenticate, which the second box captures. Keeping two statements is sound: it separates agreement to the
medium from intent to sign and mirrors the ESIGN/UETA structure. The wording need not say more for validity, but the
signing page collects personal data (name, IP, user agent, entered values), so Art 13 information must be available at
that moment; the brief does not mention a privacy-notice link on the page.

**Confidence and gaps.** Medium for England and Wales; low for the EU, because effect is a matter for each Member State
and none was surveyed.

**Suggested change, if any.** A setting for the owner's privacy-notice URL, linked beside the tick boxes, and an optional
line such as "You will be emailed a link to the signed copy. [Owner] keeps the signed record for [N] years."

**For the lawyer.** Final wording, and whether any target Member State requires more for consumer contracts.

## Q3. Proving the wording later

**Question.** Should the consent text be stored per signature or printed on the certificate?

**Law.** UK: the party relying on a signature must prove what was signed and the intent to authenticate [11]. US: where
law requires a writing, a record may be denied effect if it cannot be retained and accurately reproduced by those
entitled to keep it [1, §7001(e)]; retention is satisfied by an accurate, accessible, reproducible record [1, §7001(d)].

**Provisional view.** A hash proves the text only if someone can later produce the text that matches it. Relying on the
owner to archive every wording they ever used is a weak link, and the intent sentence is not even hashed. The consent
wording is not personal data, so storing it costs nothing in data protection terms.

**Confidence and gaps.** Medium. This is an evidential judgement; no authority speaks to consent-wording hashes.

**Suggested change, if any.** Store each wording version immutably (keyed by its hash) and print the consent wording
and the intent sentence on the certificate; hash the intent sentence as well.

**For the lawyer.** Whether printing both sentences on the certificate is desirable (it is, provisionally).

## Q4. Retention periods

**Question.** Are 12 months and 7 years good defaults, especially for minors' waivers?

**Law.** England and Wales: simple contract, 6 years from accrual [12]. Personal injury, 3 years from the later of
accrual and the claimant's date of knowledge [13]. A person is under a disability while a minor [16]; for personal
injury the 3 years run from when the disability ends [14, s.28(1), (6)]. The court may disapply personal-injury time
limits where equitable [15]. ICO: retention must be justified; keeping data to defend possible future claims is a
legitimate consideration, "just in case" is not [33]. US (two states checked): New York extends limitation for infancy
to three years after it ends, generally capped at ten years from accrual [25]; other states not checked. EU: not
surveyed.

**Provisional view.** 7 years fits adult contracts in England and Wales (6 years plus a margin). It does not cover a
minor's injury claim: a child injured at 5 can sue until 21, 16 years later, and s.33 can extend that. Note, however,
that a UK consumer waiver cannot exclude negligence liability for injury (Q8), so the record's value is chiefly as
evidence of warnings and parental agreement to participation. 12 months for separate copies is defensible because the
signed record remains.

**Confidence and gaps.** Medium for England and Wales; low for the EU and the US.

**Suggested change, if any.** A separate records period for envelopes with a guardian signer (for example 21 years, or
"until the participant would be 21 plus one year" if a birth year were collected).

**For the lawyer.** The guardian-envelope default, and whether the brief's E&W summary should add date of knowledge
and s.33.

## Q5. Name and IP kept for 7 years inside the PDF

**Question.** Is keeping name and IP inside the signed record for the records period defensible?

**Law.** UK/EU: data must be limited to what is necessary and kept identifiable no longer than necessary [27, Art
5(1)(c), (e)]. ICO: retention to defend possible claims is legitimate if justified, and data that could not be relevant
to a claim should be deleted [33]. Erasure does not apply where processing is necessary for legal claims [30, Art
17(3)(e)].

**Provisional view.** The signer's name is defensible: a signed record without the signer's name proves little. Full
IP addresses are harder. They help attribution, but their weight is modest without ISP records, and after 12 months
the salt is deleted, so the printed IP can no longer be checked against the chain (it remains bound only through the
whole-PDF hash). Keeping a full IP for 7 years "because it is in the PDF" is a design consequence, not a purpose.

**Confidence and gaps.** Medium. No regulator guidance on e-signature certificates specifically was found.

**Suggested change, if any.** A setting for IP on the certificate: full, truncated (for example /24 or /48), or none,
with the full IP kept in the database until the personal-data purge.

**For the lawyer.** Which default, and whether the owner's privacy notice must say that name and IP stay in the signed
record for the records period (it should, under Art 13(2)(a) [28a]).

## Q6. Certificate contents and data minimisation

**Question.** Which certificate items are necessary, and should a child's name be kept for 7 years?

**Law.** Art 5(1)(c) [27]. Children merit specific protection [31, recital 38]. Art 17(3)(e) [30].

**Provisional view.** Signer name: necessary. Minor's name: probably necessary, because without it a guardian waiver does
not say which child it covers; it is the minimum data that makes the record work, so keep it but print nothing else
about the child. Capacity, hashes, consent version and times: necessary and low risk. Entered values are the weak point:
the brief's own example (an emergency contact) is a third party's data needed only for the event, and owners may ask for
medical details, which may be special category data (Art 9; not researched here). Printing these on a 7-year record is
hard to justify. Because the signature hash binds entered values, they can be left off the PDF and still be proved
while the database copy exists.

**Confidence and gaps.** Medium.

**Suggested change, if any.** A per-field choice in the template: "print on the signed copy" (terms the signer agreed
to) or "operational only" (removed at the personal-data purge, not printed).

**For the lawyer.** Whether operational-only should be the default for new fields, and confirmation on the child's name.

## Q7. IP addresses

**Question.** Should IP addresses appear on the certificate, in full, truncated or not at all?

**Law.** EU: a dynamic IP address is personal data for a website operator that has legal means to identify the visitor
with the ISP's information (CJEU, Breyer, C-582/14, press release [32]). UK/EU: "online identifier" is in the
definition of personal data [26]; recital 30 names IP addresses [31]. US: no comparable rule found.

**Provisional view.** IPs are personal data in the UK and EU. The strongest point is one the brief does not raise: in a
several-signer envelope every signer receives a certificate showing every other signer's IP addresses (and names and
entered values). That is a disclosure of each signer's data to the others, which needs a purpose; for IPs it is hard to
find one. A truncated IP keeps some evidential use (rough network and location) with much less identifiability.

**Confidence and gaps.** Medium. The evidential value of IPs in English courts was not researched.

**Suggested change, if any.** Default the certificate to truncated IPs (or none), keep full IPs in the database until
the personal-data purge, and in several-signer envelopes at least avoid printing other signers' full IPs.

**For the lawyer.** Default setting, and whether co-signers may see each other's entered values.

## Q8. Guardian signing for minors

**Question.** Is guardian signing on the buyer's word reasonable, are minors' waivers enforceable, and should the
whole-group mode exist?

**Law.** England and Wales: a trader cannot exclude or restrict liability for death or personal injury from negligence
by a consumer contract term or notice, and agreeing to such a term is not by itself voluntary acceptance of risk [17];
the same rule applies to business liability in non-consumer contracts [18]. EU: a term excluding liability for a
consumer's death or injury is listed as indicatively unfair [19]. US (states checked: CO, FL, NJ, NY): Colorado's
Supreme Court held a parent "may not release a minor's prospective claim for negligence" [22]; the legislature then
allowed it, except for wilful, wanton, reckless or grossly negligent conduct [21]. Florida allows a parent to waive only
inherent-risk claims against commercial providers, with a mandatory capitalised notice [20]. New Jersey held a parent's
pre-injury release at a commercial facility unenforceable (Hojnowski, via a secondary case brief [23]). New York voids
negligence waivers for paid recreational facilities for everyone [24]. The survey is not complete (California, Texas,
Ohio and others not checked).

**Provisional view.** In England and Wales the question of parental authority is largely moot for negligence injury
claims, because even an adult's waiver cannot exclude that liability; the record still has value as evidence of
warnings and consent to take part. Recording the buyer's assertion is a reasonable product position if the buyer makes
an explicit statement. The whole-group mode records one adult's agreement only; it is weak evidence that other adults
agreed and, provisionally, should not be offered for adults.

**Confidence and gaps.** Low; enforceability is highly state-specific and EU states were not surveyed.

**Suggested change, if any.** A required, hashed statement for guardian signing ("I am the parent or legal guardian of
[participant] and have authority to sign for them"). Allow Florida-style formatted notices in templates.

**For the lawyer.** Whether to drop whole-group mode for adults; which US states the owners will use.

## Q9. Tamper evidence without an external anchor

**Question.** Is an internal hash chain enough for a simple signature, and is the certificate wording fair?

**Law.** UK/EU: an electronic signature is "data in electronic form which is attached to or logically associated with"
other data and used to sign [10]; no integrity mechanism is required for a simple signature [7][8]. Admissibility on
integrity [6]. US: copies can be self-authenticated by matching hash values under a qualified person's certification
[37, FRE 902(14)].

**Provisional view.** No law requires an external anchor for a simple signature; the chain and final hash are better than
most simple signatures offer. The current sentence "Anyone holding this PDF can check these values on the verify page"
is slightly overstated: the check works only while the site keeps the record (after the records period it answers "not
matched"), and it proves consistency with the site's own database, not independent integrity.

**Confidence and gaps.** Medium.

**Suggested change, if any.** For example: "While [site] keeps this record, anyone holding this PDF can check on the
verify page that it matches. The record is held by [site]; no independent timestamp is used."

**For the lawyer.** Final wording, and whether "not matched" after deletion should instead say "no record held".

## Q10. Identity assurance

**Question.** Is email-inbox control fair for waivers and low-value agreements, and is the OTP wording fair?

**Law.** US: a signature is attributable to a person if it was their act, shown in any manner, including the efficacy
of a security procedure (UETA §9 as enacted [5]). UK: electronic signatures are admissible on identity; there is no
prescribed form [11][6].

**Provisional view.** Email control is the market norm for low-value documents and is fair if the product does not
imply more. Two points: inline signing (Events at the booking screen) has no email control at all, so the certificate
should say how the signer reached the page; and the code prints the OTP line under the label "Identity check", which
overclaims (the brief itself says it is not identity verification).

**Confidence and gaps.** Medium.

**Suggested change, if any.** Certificate line such as "Signer's identity not verified. Access: link emailed to [masked
address]" or "signed on the site's page during booking"; rename "Identity check" to "Email access check: one-time code
sent to [masked address] entered at [time]".

**For the lawyer.** Whether the ceremony page should also tell the signer their identity is not verified.

## Q11. Notice to other adults

**Question.** Who gives privacy notice to attendees whose emails the buyer enters, and what should the invitation say?

**Law.** UK/EU: where data are not obtained from the data subject, the controller must give Art 14 information, and
where the data are used to communicate with the person, at the latest at the first communication [28]. The
disproportionate-effort exemption (UK GDPR Art 14(5)(e)) is unlikely to fit when the controller is emailing the person
anyway [28].

**Provisional view.** The site owner, as controller, must give notice, and the invitation email is the natural place:
who is asking, that the buyer supplied the address, the purpose, and a link to the full privacy notice. The 10-per-
booking cap is an abuse control; a signing invitation is probably not direct marketing (not researched), so it is not
a spam-law question in the strict sense.

**Confidence and gaps.** Medium.

**Suggested change, if any.** An invitation line: "[Buyer name] gave us your address when booking [event]. [Owner] uses
it only to ask you to sign this waiver. Privacy notice: [link]." Require the privacy-notice URL setting from Q2.

**For the lawyer.** Notice text, and whether the buyer should confirm they may share other attendees' addresses.

## Q12. Roles and contracts

**Question.** Is the owner the controller and the maker neither, and what should the maker supply?

**Law.** EDPB: not every service provider is a processor; the role follows concrete activities [36, para 82]. ICO: a
supplier is a processor where it processes data on the controller's behalf [35].

**Provisional view.** The site owner is the controller of signing data. The maker, supplying self-hosted software with
no access, is probably neither controller nor processor of that data. But the brief's §10 is out of date: the maker now
runs a licence Worker (sales through Paddle, licence emails through Cloudflare Email Service; BUILD-PLAN R67, R85, R87),
so the maker is a controller of buyer data (owner's name, email, site hostnames) and needs its own privacy notice and
processor terms with those vendors. Licence keys are verified offline (R17), so no site or signer data reaches the maker.

**Confidence and gaps.** Medium.

**Suggested change, if any.** Supply owners with: a privacy-notice template for signers (Art 13/14 items), a record of
processing template, and a note on DPIAs for children's waivers. A DPA only if the maker ever gets access (hosting,
support with database access).

**For the lawyer.** Whether support access to an owner's site would make the maker a processor, and terms for that.

## Q13. Subject requests

**Question.** Is admin-run erasure that keeps the signed record acceptable, and is manual access handling enough?

**Law.** Art 17(3)(e) excepts processing necessary for legal claims [30]. ICO: a request may be refused wholly or
partly; the controller must say why within one month and explain complaint and court remedies [34]. Art 15: access and a
copy, limited to a reasonable and proportionate search (para 1A), and, from 19 June 2026, the person must be told of the
right to complain to the controller [29].

**Provisional view.** Partial erasure is lawful if the owner can justify keeping the signed record for a plausible
claim within the limitation period, and tells the person what was kept and why. Manual access handling is lawful, but
an owner must collect data from several places (signer record, audit events, PDF, outbox) within one month, which is
error-prone without an export.

**Confidence and gaps.** Medium.

**Suggested change, if any.** After erasure, show the admin a short summary to send the requester (what was deleted,
what remains, until when, and why). Consider an export of one signer's data.

**For the lawyer.** The standard justification text, and whether owners need a complaints procedure note.

## Q14. Mail-scanner prefetch

**Question.** Is a view recorded only at first submit still meaningful, and should the certificate say so?

**Law.** No law found requires a "viewed" event for a simple signature under ESIGN, UETA or eIDAS [1][7][8].

**Provisional view.** The event is meaningful as "a person had the page open and submitted it", but it adds little to the
consent and signature events at the same moment. Calling it "viewed" invites the reading that the time is when the
signer first opened the document, which is wrong. The design choice itself (not trusting GETs) is sound.

**Confidence and gaps.** High that the label should match the behaviour; there is no authority either way.

**Suggested change, if any.** Label it "Opened and submitted" on the certificate, or add one line: "Page loads are not
recorded because email scanners open links automatically."

**For the lawyer.** Whether to record page loads separately as "link fetched (may be automated)".

## Q15. Excluded document types

**Question.** Should the product warn owners about documents that cannot be signed this way?

**Law.** US: ESIGN excludes wills and testamentary trusts, family-law matters, most of the UCC, court documents and
certain notices (utility cut-off, foreclosure or eviction of a primary residence, insurance cancellation, product
recalls, hazardous-materials documents) [2]; UETA excludes wills and most of the UCC [4a]. England and Wales: deeds that
must be witnessed need the witness physically present [11]. EU: legal effect is for national law [9].

**Provisional view.** Yes. A short warning in the template editor and operator guide, naming headline categories per
region and telling owners to take advice, is cheap and reduces misuse. Filtering documents automatically is not
feasible.

**Confidence and gaps.** High that a warning is prudent; low on completeness (UK wills and land formalities, and EU
national exclusions, were not opened).

**Suggested change, if any.** Warning text with a link to a docs page listing the categories above.

**For the lawyer.** The list for England and Wales and the main EU states.

## Q16. Uploaded PDFs

**Question.** Is original-plus-incremental-update good evidence, and is offering the PDF by link enough?

**Law.** US: records must be accurately reproducible [1, §7001(d), (e)]; hash matching authenticates copies [37]. UK:
admissibility on integrity [6]. No authority on PDF structure was found.

**Provisional view.** Keeping the original bytes intact and appending an update is arguably better evidence than
flattening, because anyone can cut the file back and match `docSha256`; flattening would destroy that check. The
residual risk (anyone can append another update after signing) is caught by `pdfSha256` and `/verify`. On display: a
link the signer may ignore is weaker evidence that the document was shown than inline text; reasonable-notice case law
(US clickwrap) was not researched.

**Confidence and gaps.** Low on the notice point; medium on the file format.

**Suggested change, if any.** Require the signer to open or download the PDF before the Sign button is enabled, and
record that as a page action (not a link fetch).

**For the lawyer.** Whether "offered by link" plus a required open is enough notice in the target jurisdictions.

## Corrections to the brief

1. §2, last bullet: ESIGN §7001(c) does not apply whenever electronic records replace paper for consumers; it applies
   only where a law requires information to be provided to a consumer in writing [1]. The bullet also points to
   "question 2"; the US consent question is question 1.
2. §2, Editions, says the email one-time code is "not built yet", but §6 describes it as built in Pro (T091). §12's last
   bullet also says Pro features are not reviewed code, while §6 and [C35] cite Pro code.
3. §2 calls it a "simple electronic signature (SES) under eIDAS". eIDAS defines only "electronic signature",
   "advanced" and "qualified" [10]; "simple" is industry usage.
4. §10 says the maker has not set up a licence service. BUILD-PLAN R67, R85 and R87 describe a licence Worker that
   handles buyer data, so the maker is a controller for that data (Q12).
5. Question 4: the 3-year personal-injury period runs from the later of accrual and date of knowledge [13], may be
   disapplied by the court [15], and for minors runs from age 18 [14][16]. "Extended times for minors" is right but
   should say how long.
6. §6 labels the OTP line on the certificate as described; the code prints it under the field "Identity check"
   (`packages/esign/src/domain/pdf.ts`), which the brief does not mention.

## Also noticed

- **Waivers cannot exclude negligence injury liability in the UK** [17][18], and such terms are indicatively unfair in
  the EU [19]. Owners may believe an E-sign waiver protects them; operator docs should say this plainly.
- **Co-signers see each other's data.** In several-signer envelopes every signer's copy prints every signer's name, IP
  and entered values (Q7).
- **No privacy-notice link on the signing page**, although it collects personal data (Q2, Art 13 [28a]).
- **Florida-style statutory notices** need capitalised text at least 5 points larger than the rest [20]; the template
  renderer should be able to produce it.
- **International transfers.** Hosting on a US provider may be a restricted transfer for UK/EU owners; not researched,
  owner's responsibility, worth a line in the operator guide.

## Sources

All accessed 2026-10-26.

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
11. Law Commission, Electronic execution of documents (project page and statement of law),
    https://lawcom.gov.uk/project/electronic-execution-of-documents/, primary (law reform body).
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
    https://www.lexplug.com/casebrief/hojnowski_ex_rel_hojnowski_v_vans_skate_park_680860ce3f5cc0c6cc41b7e1, secondary
    (the opinion itself could not be opened).
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
    judgment itself could not be opened).
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
