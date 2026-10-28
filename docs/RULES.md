# Auto-Auto business rules

Decided during the design phase (Oct 2026). The prototypes in `/prototypes` show each rule on screen. Numbers marked *setting* live in the Ops Console's Pricing & rules page and must stay editable, versioned, and apply only to bookings made after a change.

## Pricing

- **Labor** = standard book time for the exact vehicle × **$100/hr** *setting*. Shown next to a typical local shop rate of **$140/hr** *setting* for comparison.
- **Parts markup** (tiered by part cost) *settings*: under $50 → 50%, $50–200 → 35%, $200–500 → 25%, over $500 → 15%. Oil and fluids → 30%.
- **Mobile service fee:** $15 per visit *setting*, goes to the partner. One per visit no matter how many services.
- **Service protection fee:** $3 per job *setting*, funds Partner Protection.
- **Quick fixes** (under an hour): flat labor plus parts at cost + 15% *setting*. Headlight bulb $25, brake/tail bulb $15, wipers $10, fluid check $20, cabin filter $15, battery $35, TPMS reset $20, tire plug $30, fuse $15, key fob battery $10, code scan $30, headlight restoration $60, serpentine belt $55.
- **Glass:** chip repair is a fixed price. Replacements are quoted: the partner looks up the glass for the VIN, enters their cost, part number, and supplier. Customer price = cost + 15% *setting* + $28 install kit *setting* + book-time labor + camera calibration (2.5 hr) when needed. Above the typical cost range the partner must attach the supplier's quote and a note. Nothing is ordered until the customer approves. Declining is free for both sides.
- **Diagnose It:** $49 visit *setting*, credited if the repair quote is approved within 7 days.
- **Plus membership:** $9.99/mo *setting*, waives mobile and protection fees.

## Partner pay

- Partner earns **labor − 20% platform fee** *setting* + the mobile fee. The fee is taken from labor only.
- **Minimum $35 per visit** *setting*; Auto-Auto tops up small jobs.
- Parts are bought with the **Auto-Auto parts card** (virtual card per job, loaded with the parts estimate + 10% *setting*, auto-parts stores only, locks when the job closes). Parts from the partner's own stock are reimbursed at cost, shown apart from earnings.
- **Payouts:** daily at 9 PM *setting* for partners with 10+ jobs *setting*, weekly before that or by choice. New partners: 5% reserve *setting* until daily unlocks. Instant cash-out $0.85 *setting*.
- Open claim or dispute: only that job's pay is held. Money owed (deductibles, charge-backs) is recovered from payouts, max 25% of any one payout *setting*.

## Booking and payment

- Customer address stays hidden until the partner taps Start Trip. Partners have adjustable service areas.
- Card is saved at booking. Jobs over $300 *setting* take a deposit of 25% or the parts cost, whichever is higher. The estimate is **held 24 hours before** the visit *setting*; the final total is charged after the work.
- If the charge fails at completion, the **partner is still paid**; Auto-Auto collects from the customer.
- Add-ons always need customer approval (fleets set an auto-approve limit per vehicle).
- Proof of work: 12 check-in photos (360° + interior) and odometer before work; 2 after photos and an 8-item inspection report before Complete.

## Dispatch

- Instant requests go to the **closest qualified partner first, one at a time, 30 seconds each, up to 5 partners**, then to everyone in range *settings*.
- Request windows: 4 hours normal, 1 hour roadside *settings*. Halfway through, the search **widens to 35 miles** *setting*. If nobody accepts, the request closes, any deposit is refunded, and the customer is shown the next open times.
- **Customer approval** (when the customer turned on "approve partner"): 5 minutes same day, 2 hours scheduled *settings*. No answer → offer goes to the next partner.
- Contact: in-app chat and masked calling only; real phone numbers are never shared.

## Cancellations

- **Customer:** free more than 48 hours out *setting*; $25 inside 48 hours; $50 once the partner is on the way or after a 15-minute no-show; plus any parts already bought (receipt required). 2 free reschedules, then $25.
- **Partner:** free more than 24 hours out *setting*. Inside 24 hours it's a late cancel: counts on their record and the customer gets a **$15 credit** *setting* paid by Auto-Auto. 3 late cancels in 30 days *setting* starts an account review. The job goes back out first in line.
- Partner hasn't left 30 minutes before the window: customer can switch to a backup partner or reschedule free with a $10 credit.

## Fleet

- Same pricing model with a fleet labor rate (default **$85/hr** *setting*, set per fleet), parts at cost + 10% *setting*, and one **$25 trip fee** per visit *setting* instead of a per-vehicle mobile fee.
- Vehicle classes: van/pickup, box truck, tractor, trailer. Bigger vehicles get longer labor times and larger parts costs; services that don't fit a class (glass on a trailer) are skipped.
- Fleet services beyond maintenance: **DOT safety** (annual inspection under 49 CFR 396.17 by a qualified inspector per 396.19, brake inspection per 396.25, DVIR defect repair and sign-off per 396.11, lights, wipers, tires, fire extinguisher and triangles), **glass**, and **washing** ($60/hr wash rate *setting*).
- Partners need proof on file to offer DOT inspections, brake work, glass, and washing (water containment).
- Net 30 accounts need a credit check and approval with a credit limit; card-on-file accounts start right away.
- Each vehicle gets a maintenance log (photos, odometer, inspection, notes). A finished visit creates one invoice. Partners are paid on their normal schedule whether or not the fleet has paid.

## Insurance

- **Partner Protection** (default): general liability and garagekeepers while on an Auto-Auto job, funded by the $3 fee. Partner pays a $500 deductible *setting* on at-fault claims.
- Partners may opt out with their own insurance by signing the Own Insurance Election & Indemnity.

## Not decided yet

- Exact insurer and policy terms for Partner Protection (needs broker quotes).
- Lawyer review of every agreement in the partner onboarding flow.
- Email and text provider (the app supports Twilio for texts and Resend or Postmark for email; pick one and add its keys), background-check provider, repair-data (book time) license.
