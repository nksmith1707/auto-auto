// Every document a partner reads or signs during onboarding (from prototypes/partner-app.html).
// Drafts for attorney review (RULES.md, Not decided yet). Changing any text means a new version number:
// each signature records the version and a fingerprint (SHA-256) of the exact text that was signed.
import { createHash } from "node:crypto";

export const DRAFT_NOTE = "Draft for attorney review · not legal advice";

const DOCS = [
  {
    id: "esign", title: "Consent to Electronic Signatures and Records", version: "0.1", kind: "consent",
    paragraphs: [
      ["Electronic records", "I agree to sign and receive documents electronically, including agreements, tax forms, notices, and background check documents."],
      ["Paper copies and withdrawing", "I can get a paper copy of any document, or withdraw this consent, at any time by contacting partner support. Withdrawing ends my ability to use the Auto-Auto Partner app."],
      ["What I need", "I have a device that can open and save PDF files and an email address that works. (E-SIGN Act, 15 U.S.C. § 7001)"],
    ],
  },
  {
    id: "w9", title: "W-9 Certification", version: "0.1", kind: "signature",
    paragraphs: [
      ["Taxpayer ID", "My taxpayer ID number (SSN or EIN) is entered on the secure page of Auto-Auto's payment processor, Stripe, during payout setup. Auto-Auto does not store it."],
      ["Certification", "Under penalties of perjury, I certify that: (1) the taxpayer ID number I give for my payouts is correct; (2) I am not subject to backup withholding, or the IRS has told me I'm no longer subject to it; (3) I am a U.S. citizen or other U.S. person; and (4) any FATCA codes entered are correct."],
    ],
  },
  {
    id: "bg_disclosure", title: "Disclosure Regarding Background Investigation", version: "0.1", kind: "disclosure",
    paragraphs: [
      ["", "Auto-Auto, Inc. (\"Auto-Auto\") may obtain information about you from a third-party consumer reporting agency for the purpose of deciding whether you may provide services through the Auto-Auto platform. Auto-Auto may also obtain reports periodically while you remain on the platform, if allowed by law."],
      ["", "This information may be obtained in the form of consumer reports and may include your criminal history, motor vehicle (driving) records, sex offender registry status, identity and address history, and verification of licenses and certifications you provide."],
      ["", "The consumer reporting agency is: [Background check vendor name], [mailing address], [phone], [website]. You may contact them to see what's in your file."],
    ],
  },
  {
    id: "bg_auth", title: "Background Check Authorization", version: "0.1", kind: "signature",
    paragraphs: [
      ["Authorization", "I authorize Auto-Auto, Inc. and its consumer reporting agency to obtain the consumer reports described in the Disclosure Regarding Background Investigation, now and periodically while I use the platform, where the law allows. I authorize anyone holding information about me, including courts, motor vehicle departments, and licensing bodies, to release it to the consumer reporting agency for this purpose."],
      ["Your rights", "I've received A Summary of Your Rights Under the Fair Credit Reporting Act (consumerfinance.gov). If something in a report could affect my approval, I'll get a copy of the report and a chance to respond before any final decision."],
      ["State notices", "If you live or work in California, Minnesota, New York, Oklahoma, Washington, or another state with extra rules, the matching state notices are added here before launch there."],
    ],
  },
  {
    id: "ica", title: "Independent Contractor Agreement", version: "0.1", kind: "agreement",
    paragraphs: [
      ["Who we are", "Auto-Auto, Inc. runs a marketplace platform that connects vehicle owners with independent service providers. You are a marketplace contractor, not an employee, agent, or partner of Auto-Auto. This agreement is intended to meet Tennessee's marketplace contractor law (Tenn. Code Ann. § 50-8-101 et seq.)."],
      ["You run your business", "You decide whether and when to log in, which jobs to accept or decline, your service area, and your hours. Auto-Auto does not set hours you must be available."],
      ["No exclusivity", "You may use other platforms, run your own shop, and work any other job or business at the same time."],
      ["Helpers", "You may use an assistant. Any assistant must pass the same screening before working on a customer vehicle, and you pay them, not Auto-Auto."],
      ["Tools and methods", "You choose and supply your own tools, vehicle, and supplies. Auto-Auto does not control how you perform the work. It does set minimum safety, documentation, and customer-privacy standards that every partner meets."],
      ["Pay", "Substantially all of your pay comes from jobs you complete for customers. Auto-Auto keeps a platform fee, shown on every job before you accept it."],
      ["Taxes and benefits", "Auto-Auto does not withhold taxes or provide health, workers' compensation, or other insurance for you. You are responsible for your own taxes, licenses, and insurance."],
      ["Ending this agreement", "Either party may end this agreement at any time, with or without cause, by written notice in the app. Auto-Auto will tell you the reason if you are deactivated and give you a way to appeal."],
    ],
  },
  {
    id: "liab", title: "Liability, Damage & Indemnification", version: "0.1", kind: "agreement",
    paragraphs: [
      ["Your responsibility", "You are responsible for property damage or injury caused by your work, your tools, your vehicle, or anyone working with you."],
      ["Check-in photos", "Before touching a vehicle you take 8 exterior photos, 4 interior photos, and the odometer reading, and mark any existing damage. These are the shared record of the vehicle's condition. If you skip them, existing damage may be treated as caused by you."],
      ["Reporting damage", "If damage happens, photograph it, tell the customer, and report it in the app within 24 hours. Do not settle privately or off the platform."],
      ["Claims process", "Auto-Auto reviews claims using check-in photos, after photos, job notes, location data, and statements from both sides. If there is clear evidence you caused the damage, you or your insurer are responsible for the repair cost. You can respond to any claim before a decision."],
      ["Indemnification", "You agree to defend and reimburse Auto-Auto for claims, losses, and costs that come from your work, your negligence, or your breach of these terms, except to the extent Auto-Auto caused them."],
      ["Insurance first", "Claims go first to the insurance that covers the job: Auto-Auto Partner Protection, or your own policies if you opted out. If Partner Protection pays a claim you caused, you pay the $500 deductible from your payouts. Jobs pause automatically if required coverage lapses."],
    ],
  },
  {
    id: "pay", title: "Payments, Fees & Cancellations", version: "0.1", kind: "agreement",
    paragraphs: [
      ["How customers pay", "Customers pay through the app. The estimate is held on the customer's card before the visit and charged when you tap Complete. Larger jobs require a customer deposit. Never accept cash or payment outside the app for platform jobs."],
      ["Platform fee", "Auto-Auto keeps a platform fee (currently 20%) shown before you accept each job."],
      ["Service protection fee", "Customers pay a service protection fee (currently $3) on every job. It funds Partner Protection. If you opt out and use your own insurance, you receive it as a credit on each job."],
      ["Tips", "You receive 100% of tips, as Tennessee law requires for marketplace contractors (Tenn. Code Ann. § 50-8-104)."],
      ["Customer cancellations", "If a customer cancels inside 48 hours you receive most of the $25 late fee. If they cancel while you're on the way, or don't show up, you receive most of the $50 fee."],
      ["Your cancellations", "Releasing a job inside 24 hours of the start counts toward your cancellation rate. Parts you ordered before releasing a job are yours to keep or return."],
      ["Payouts", "Earnings are deposited at no cost: weekly for your first 10 completed jobs, then daily. Until daily unlocks, 5% of each payout is kept as a reserve and paid back when it does. Instant cash-out costs $0.85. If a job has an open claim or payment dispute, only that job's pay is held until it's resolved. Amounts you owe (deductibles, comeback charge-backs, reversed customer payments) are recovered from future payouts, no more than 25% of any one payout."],
      ["Parts", "Parts reimbursement is paid separately from earnings and isn't a payment for your services. Parts you buy for a job are reimbursed at cost with your payout. When the Auto-Auto parts card is available, use it only for parts and supplies for the assigned job; personal use is a material breach."],
    ],
  },
  {
    id: "privacy", title: "Customer Privacy & Data Use", version: "0.1", kind: "agreement",
    paragraphs: [
      ["Addresses", "You see a customer's exact address only when you start the trip, and only for that job. Don't save, share, or reuse it."],
      ["Contact", "Use the in-app chat. Don't ask for or give personal phone numbers, and don't contact customers outside the app about platform jobs."],
      ["Photos", "Vehicle photos are for the job record only. Don't post them, and keep license plates and people out of social media."],
      ["Your data", "Auto-Auto uses your location while you're online or on a job, your documents to verify eligibility, and job records to resolve disputes. See the Privacy Policy for details and your rights."],
    ],
  },
  {
    id: "safety", title: "Safety, Environmental & Conduct Standards", version: "0.1", kind: "agreement",
    paragraphs: [
      ["Lifting", "Never work under a vehicle supported only by a jack. Use stands or a lift rated for the vehicle, on firm level ground, with wheels chocked."],
      ["Fluids", "Use drip pans and keep a spill kit on hand. Clean up any spill on the customer's property right away."],
      ["Used oil and filters", "Store used oil in closed containers labeled \"Used Oil\". Take it to a used-oil collection center (no more than 55 gallons per trip without a transporter license). Hot-drain used filters before disposal. (40 CFR Part 279)"],
      ["Refrigerant", "A/C work requires EPA Section 609 certification and approved recovery equipment. Never vent refrigerant."],
      ["Lockouts", "Unlock a vehicle only after checking the customer's photo ID matches the account and the vehicle registration or proof of ownership."],
      ["Conduct", "No drugs or alcohol on the job, no weapons on customer property, no harassment or discrimination. Leave the work area as clean as you found it."],
    ],
  },
  {
    id: "arb", title: "Dispute Resolution & Arbitration", version: "0.1", kind: "agreement",
    paragraphs: [
      ["Talk first", "Most problems get solved through support. Before filing anything, either side sends a written notice and both try to resolve it for 30 days."],
      ["Arbitration", "If it isn't resolved, disputes go to individual binding arbitration instead of court, except small-claims cases and claims the law doesn't allow to be arbitrated."],
      ["Class waiver", "Disputes are handled individually, not as part of a class or collective action."],
      ["Your right to opt out", "You can opt out of arbitration within 30 days of signing by sending notice in the app (Agreements → Opt out of arbitration). Opting out does not affect anything else about your account."],
    ],
  },
  {
    id: "optout", title: "Own Insurance Election & Indemnity", version: "0.1", kind: "signature",
    paragraphs: [
      ["Election", "I choose not to be covered by Auto-Auto Partner Protection. My own insurance will cover every Auto-Auto job I perform."],
      ["Coverage I'll keep", "At my own cost: general liability of at least $1,000,000 per occurrence and $2,000,000 aggregate; garagekeepers of at least $100,000 per occurrence that applies at customer locations; and vehicle insurance that covers business use."],
      ["Additional insured, primary", "Auto-Auto, Inc. will be named as an additional insured on my general liability policy. My insurance is primary and non-contributory: it pays first, and Auto-Auto's insurance is not asked to share the cost."],
      ["Waiver of subrogation", "I'll ask my insurers to waive subrogation against Auto-Auto, so they can't seek repayment from Auto-Auto for claims they pay."],
      ["Release", "I release Auto-Auto from any claim that arises because my insurance is missing, lapsed, cancelled, too low, denied, or doesn't apply. Any coverage gap is my responsibility."],
      ["Indemnification", "I'll defend, pay, and hold harmless Auto-Auto, its owners, and employees for claims, damages, legal fees, and costs from my work, including amounts my insurance doesn't pay, except where Auto-Auto itself caused the harm."],
      ["Customers come first", "If my insurer denies or delays a valid claim for damage I caused, Auto-Auto may pay the customer directly to resolve it, and I'll repay Auto-Auto. Auto-Auto may recover that amount from my payouts."],
      ["Notice of changes", "I'll tell Auto-Auto within 5 days of any cancellation, non-renewal, or reduction of my coverage and upload renewed certificates before they expire. My account pauses automatically while my coverage is below these minimums."],
      ["Credit", "While this election is active, I receive the customer's service protection fee (currently $3) as a credit on each job."],
      ["Switching back", "I can switch to Partner Protection at any time in the app. This election ends then, but it still applies to jobs I completed before switching."],
    ],
  },
];

// The six agreements every partner signs in the Agreements step.
export const AGREEMENT_IDS = ["ica", "liab", "pay", "privacy", "safety", "arb"];

const fingerprint = (d) => createHash("sha256").update(JSON.stringify([d.id, d.version, d.title, d.paragraphs])).digest("hex");
const BY_ID = Object.fromEntries(DOCS.map((d) => [d.id, { ...d, hash: fingerprint(d) }]));

export const documentById = (id) => BY_ID[id] || null;
export const documentOut = (d) => ({ id: d.id, title: d.title, version: d.version, kind: d.kind, paragraphs: d.paragraphs.map(([heading, text]) => ({ heading, text })), hash: d.hash, draftNote: DRAFT_NOTE });
