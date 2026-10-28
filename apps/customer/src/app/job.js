// One booking, start to finish: status, partner, add-on approvals, cancel or reschedule, and the receipt.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { STATUS_LABEL, bookingDays, fmtDay, fmtLeft, fmtTime, fmtWhen, fmtWindow } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Card, Chips, LinkButton, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { VisitPhotos } from "../components/Photos";
import { Stars } from "../components/Care";

const STEPS = ["requested", "confirmed", "en_route", "arrived", "in_progress", "completed"];
const STEP_LABEL = { requested: "Booked", confirmed: "Confirmed", en_route: "On the way", arrived: "Arrived", in_progress: "Working", completed: "Done" };
const INSPECTION = { brakes: "Brakes", tires: "Tires", fluids: "Fluids", battery: "Battery", wipers: "Wipers", lights: "Lights", belts_hoses: "Belts & hoses", filters: "Filters" };
const RATING = { good: "Good", soon: "Soon", now: "Needs attention" };
const EVENT = {
  booked: "Booked", accepted: "A partner accepted", confirmed: "Confirmed", partner_approved: "You approved your partner", partner_declined_by_customer: "You picked someone else",
  approval_timed_out: "No answer in time; finding another partner", trip_started: "Partner is on the way", arrived: "Partner arrived", checked_in: "Work started",
  addons_requested: "Partner asked to add work", addon_approved: "You approved an add-on", addon_declined: "You declined an add-on", glass_quote_sent: "Glass quote sent",
  glass_approved: "You approved the glass quote", glass_declined: "You declined the glass quote", completed: "Completed", cancelled: "Cancelled", expired: "No partner found in time",
  rescheduled: "Rescheduled", partner_cancelled: "Partner cancelled; finding another partner", partner_late_cancel: "Partner cancelled late; $15 credit added",
  switched_partner: "You switched partners", no_show: "Marked as a no-show",
  claim_filed: "You reported damage", warranty_requested: "Warranty return requested", warranty_return_requested: "You asked for a warranty return",
  warranty_to_board: "Offered to other partners", warranty_declined: "Original partner can't make it", incident_reported: "Partner filed a report",
  offer_sent: "Offered to a nearby partner", offer_declined: "A partner passed", offer_expired: "No answer; trying the next partner",
  sent_to_all: "Sent to all partners nearby", search_widened: "Widened the search to 35 miles", offer_accepted: "A partner accepted",
};

function Row({ left, right, strong, hint }) {
  const t = useTheme();
  const st = strong ? { fontFamily: t.f.displayX, fontSize: 17 } : null;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <T v={hint ? "hint" : "small"} style={[{ flex: 1 }, st]}>{left}</T><T v={hint ? "hint" : "small"} style={st}>{right}</T>
    </View>
  );
}

const PAY_KIND = { deposit: "Deposit", hold: "Card hold", charge: "Charged", fee: "Fee", refund: "Refunded" };
const PAY_STATUS = { held: "held", captured: "charged", released: "released", succeeded: "", failed: "failed" };

// What's been held, charged, and refunded on this visit, and a way to fix a declined card.
function PaymentCard({ job, busy, onPay, onCards }) {
  const t = useTheme();
  const p = job.payment;
  if (!p.items.length && !p.problem) {
    if (["cancelled", "expired"].includes(job.status)) return null;
    return <T v="hint" style={{ textAlign: "center" }}>We hold the estimate on your card 24 hours before the visit and charge the final total when the work is done.</T>;
  }
  return (
    <Card style={{ gap: 6 }} testID="payment">
      <T v="title">Payment</T>
      {p.items.map((it) => (
        <Row key={it.id} hint={it.kind === "hold" && it.status !== "captured"}
          left={`${PAY_KIND[it.kind]}${PAY_STATUS[it.status] ? ` (${PAY_STATUS[it.status]})` : ""}${it.card ? ` · ${it.card}` : ""}`}
          right={money((it.kind === "refund" ? -1 : 1) * (it.status === "captured" ? it.capturedCents : it.amountCents), { always: true })} />
      ))}
      <Row left="Paid" right={money(p.paidCents, { always: true })} strong />
      {p.problem ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Notice tone="bad">{p.dueCents ? `Your card was declined. ${money(p.dueCents, { always: true })} is still due.` : "We couldn't hold the estimate on your card. Add or choose another card so your visit stays on."}</Notice>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button style={{ flex: 1 }} title="Change card" variant="ghost" onPress={onCards} />
            <Button style={{ flex: 1 }} title={p.dueCents ? "Pay now" : "Try again"} onPress={onPay} loading={busy} testID="pay-now" />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export default function JobScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id, fresh } = useLocalSearchParams();
  const { call } = useAuth();
  const [job, setJob] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [mode, setMode] = useState(null); // "cancel" | "reschedule"
  const [refreshing, setRefreshing] = useState(false);
  const days = useMemo(() => bookingDays(), []);
  const [day, setDay] = useState(days[0] ? days[0].day : null);
  const [slot, setSlot] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  const load = useCallback(async () => {
    try { setJob((await call("job", id)).job); setErr(null); } catch (e) { setErr(e.message); }
  }, [call, id]);
  useEffect(() => { load(); }, [load]);
  // Keep it current while open. Push notifications come later.
  useEffect(() => { const i = setInterval(() => { load(); setNowTick(Date.now()); }, 15000); return () => clearInterval(i); }, [load]);

  async function act(name, fn) {
    setErr(null);
    setBusy(name);
    try { const r = await fn(); if (r && r.job) setJob(r.job); setMode(null); } catch (e) { setErr(e.message); await load(); } finally { setBusy(null); }
  }

  if (!job) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;

  const open = !["completed", "cancelled", "expired"].includes(job.status);
  const stepIdx = STEPS.indexOf(job.status === "awaiting_approval" ? "requested" : job.status);
  const pending = job.addons.filter((a) => a.status === "pending");
  const rescheduleFee = job.partnerLate || job.freeReschedulesLeft > 0 ? 0 : 2500;
  const daySlots = (days.find((d) => d.day === day) || { slots: [] }).slots;

  return (
    <Screen contentStyle={{ paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.c.muted} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        {fresh && job.status === "requested" ? <Notice tone="ok">{job.warrantyReturn ? "Warranty return requested. No charge." : "Booking received. We're finding your partner now."}</Notice> : null}
        {job.warrantyReturn ? (
          <Notice testID="warranty-return">{`Warranty return · no charge. ${job.warrantyReturn.issueLabel || ""}. ${job.warrantyReturn.withOriginalPartner ? "Your original partner gets the first chance to come back." : "Another partner is handling it."}`}</Notice>
        ) : null}
        <View style={{ gap: 4, alignItems: "center" }}>
          <T v="h1" accessibilityRole="header" testID="job-status">{STATUS_LABEL[job.status]}</T>
          <T v="muted" style={{ textAlign: "center" }}>{job.vehicle.year} {job.vehicle.make} {job.vehicle.model} · {job.place.label}</T>
          <T v="small" style={{ fontFamily: t.f.bodyB }}>{job.kind === "scheduled" ? fmtWindow(job.windowStart, job.windowEnd) : job.kind === "roadside" ? "Roadside help" : "As soon as possible"}</T>
        </View>

        {open && job.status !== "awaiting_approval" ? (
          <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`Step ${stepIdx + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <View key={s} style={{ flex: 1, gap: 4, alignItems: "center" }}>
                <View style={{ height: 6, width: "100%", borderRadius: 3, backgroundColor: i <= stepIdx ? t.c.brand : t.c.line }} />
                <Text style={{ fontFamily: t.f.bodyB, fontSize: 10, color: i <= stepIdx ? t.c.brand : t.c.muted }} numberOfLines={1}>{STEP_LABEL[s]}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {job.status === "requested" ? (
          <Notice>{job.kind === "scheduled" ? "Partners near you are seeing your request now. You'll see who's coming as soon as one accepts." : `Looking for a partner now. Time left: ${fmtLeft(job.requestExpiresAt - nowTick)}.`}</Notice>
        ) : null}

        {job.status === "awaiting_approval" && job.partner ? (
          <Card style={{ gap: 10, borderColor: t.c.brand, borderWidth: 2 }}>
            <T v="title">Approve your partner</T>
            <T v="small">{job.partner.name}{job.partner.rating && job.partner.rating.average ? ` · ★ ${job.partner.rating.average.toFixed(1)} (${job.partner.rating.count})` : ""} · {job.partner.jobsDone} job{job.partner.jobsDone === 1 ? "" : "s"} done on Auto-Auto</T>
            <T v="hint">Answer within {fmtLeft(job.approvalDeadline - nowTick)}, or we'll offer the job to the next partner.</T>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button style={{ flex: 1 }} title="Pick someone else" variant="ghost" loading={busy === "decline"} onPress={() => act("decline", () => call("jobAction", job.id, "decline-partner"))} />
              <Button style={{ flex: 1 }} title="Approve" loading={busy === "approve"} onPress={() => act("approve", () => call("jobAction", job.id, "approve-partner"))} testID="approve-partner" />
            </View>
          </Card>
        ) : job.partner ? (
          <Card style={{ gap: 4 }}>
            <Text style={t.text.label}>Your partner</Text>
            <T style={{ fontFamily: t.f.displayX, fontSize: 18 }}>{job.partner.name}</T>
            <T v="hint">{job.partner.rating && job.partner.rating.average ? `★ ${job.partner.rating.average.toFixed(1)} (${job.partner.rating.count}) · ` : ""}{job.partner.jobsDone} job{job.partner.jobsDone === 1 ? "" : "s"} done · Phone numbers are never shared.</T>
            {["confirmed", "en_route", "arrived", "in_progress"].includes(job.status) || (["completed", "cancelled"].includes(job.status) && Date.now() - (job.updatedAt || 0) < 86_400_000) ? (
              <Button title={`Message ${job.partner.name.split(" ")[0]}`} variant="ghost" onPress={() => router.push({ pathname: "/chat", params: { id: job.id, name: job.partner.name } })} testID="open-chat" />
            ) : null}
          </Card>
        ) : null}

        {job.partnerLate && open ? (
          <Card style={{ gap: 8, borderColor: t.c.bad }}>
            <T v="title">Your partner hasn't left yet</T>
            <T v="small">Switch to another partner, or reschedule for free and get a $10 credit.</T>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button style={{ flex: 1 }} title="Switch partner" variant="ghost" loading={busy === "switch"} onPress={() => act("switch", () => call("jobAction", job.id, "switch-partner"))} />
              <Button style={{ flex: 1 }} title="Reschedule free" onPress={() => setMode("reschedule")} />
            </View>
          </Card>
        ) : null}

        {pending.map((a) => (
          <Card key={a.id} style={{ gap: 8, borderColor: t.c.brand, borderWidth: 2 }} testID="addon-card">
            <T v="title">{a.kind === "glass" ? "Glass quote" : "Your partner found something"}</T>
            <Row left={a.line.name} right={money(a.line.priceCents, { always: true })} strong />
            {a.kind === "glass" ? <T v="hint">{a.line.partNumber} from {a.line.supplier}{a.line.calibrationCents ? ` · includes camera calibration ${money(a.line.calibrationCents)}` : ""}. Nothing is ordered until you approve. Declining is free.</T> : null}
            {a.reason ? <T v="small">"{a.reason}"</T> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button style={{ flex: 1 }} title="Decline" variant="ghost" loading={busy === `d${a.id}`} onPress={() => act(`d${a.id}`, () => call("addonDecision", job.id, a.id, false))} />
              <Button style={{ flex: 1 }} title="Approve" loading={busy === `a${a.id}`} onPress={() => act(`a${a.id}`, () => call("addonDecision", job.id, a.id, true))} testID="approve-addon" />
            </View>
          </Card>
        ))}

        {job.status === "completed" && job.final ? (
          <Card style={{ gap: 6 }} testID="receipt">
            <T v="title">Receipt</T>
            {job.final.lines.map((l) => <Row key={l.serviceId} left={job.addons.some((a) => a.kind === "addon" && a.status === "approved" && a.serviceId === l.serviceId) ? `${l.name} (added)` : l.name} right={money(l.priceCents, { always: true })} />)}
            {job.final.fees.map((f) => <Row key={f.id} hint left={f.label} right={money(f.cents, { always: true })} />)}
            <Row left="Total" right={money(job.final.totalCents, { always: true })} strong />
            {job.final.creditsCents ? <Row left="Account credit" right={money(-job.final.creditsCents, { always: true })} /> : null}
            {job.final.creditsCents ? <Row left="You pay" right={money(job.final.chargeCents, { always: true })} strong /> : null}
          </Card>
        ) : (
          <Card style={{ gap: 6 }}>
            <T v="title">Estimate</T>
            {job.quote.lines.map((l) => <Row key={l.serviceId} left={l.name} right={money(l.priceCents, { always: true })} />)}
            {job.addons.filter((a) => a.status === "approved").map((a) => <Row key={a.id} left={`${a.line.name} (added)`} right={money(a.line.priceCents, { always: true })} />)}
            {job.quote.pending.filter((p) => !job.addons.some((a) => a.serviceId === p.serviceId && a.status === "approved")).map((p) => <Row key={p.serviceId} left={p.name} right="Quote" />)}
            {job.quote.fees.map((f) => <Row key={f.id} hint left={f.label} right={money(f.cents, { always: true })} />)}
            <Row left="Total" right={money(job.quote.totalCents + job.addons.filter((a) => a.status === "approved").reduce((s, a) => s + a.line.priceCents, 0), { always: true })} strong />
          </Card>
        )}

        {job.status === "completed" && job.care ? (
          <Card style={{ gap: 10 }} testID="after-visit">
            {job.care.rating ? (
              <View style={{ gap: 4, alignItems: "center" }}>
                <T v="label">You rated this visit</T>
                <Stars value={job.care.rating.stars} size={26} />
                {job.care.tip ? <T v="hint">{`Tip: ${money(job.care.tip.amountCents, { always: true })}. Thank you!`}</T> : null}
                {!job.care.tip && Date.now() < job.care.tipOpenUntil ? <LinkButton title={`Add a tip for ${job.partner ? job.partner.name.split(" ")[0] : "your partner"}`} onPress={() => router.push({ pathname: "/rate", params: { id: job.id, tipOnly: "1" } })} /> : null}
              </View>
            ) : job.care.canRate ? (
              <View style={{ gap: 8 }}>
                <T v="title">How did {job.partner ? job.partner.name.split(" ")[0] : "it"} do?</T>
                <T v="hint">{Date.now() < job.care.tipOpenUntil ? "Rate the visit and add a tip. 100% of tips go to your partner." : "Rate the visit. It helps other drivers."}</T>
                <Button title="Rate & tip" onPress={() => router.push({ pathname: "/rate", params: { id: job.id } })} testID="open-rate" />
              </View>
            ) : null}
            {job.care.claims.map((c) => (
              <Card key={c.id} onPress={() => router.push({ pathname: "/claim", params: { id: c.id } })} accessibilityLabel={`Claim ${c.number}`} style={{ gap: 2 }}>
                <T v="small" style={{ fontFamily: t.f.bodyB }}>{`Claim ${c.number}`}</T>
                <T v="hint">{c.status === "closed" ? "Decided" : c.status === "review" ? "We're reviewing it" : "Waiting for your partner's response"} ›</T>
              </Card>
            ))}
            {job.care.openWarrantyReturn && !job.warrantyReturn ? (
              <Button title="Open your warranty return" variant="ghost" onPress={() => router.push({ pathname: "/job", params: { id: job.care.openWarrantyReturn } })} />
            ) : null}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
              {job.care.warrantyActive && !job.care.openWarrantyReturn ? <LinkButton title="Problem with this repair?" onPress={() => router.push({ pathname: "/warranty", params: { id: job.warrantyReturn ? job.warrantyReturn.originalJobId : job.id } })} /> : null}
              {!job.care.claims.some((c) => c.status !== "closed") ? <LinkButton title="Report damage" onPress={() => router.push({ pathname: "/claim-new", params: { jobId: job.id } })} textStyle={{ color: t.c.bad }} /> : null}
            </View>
          </Card>
        ) : null}

        {job.payment && job.payment.enabled && !job.warrantyReturn ? <PaymentCard job={job} busy={busy === "pay"}
          onPay={() => act("pay", () => call("payJob", job.id))} onCards={() => router.push("/cards")} /> : null}

        {job.photos && (job.photos.checkin.length || job.photos.after.length) ? (
          <Card style={{ gap: 10 }} testID="visit-photos">
            <T v="title">Photos</T>
            <T v="hint">Your partner photographs the vehicle before touching it and after the work. They're time-stamped and saved to your service history.</T>
            <VisitPhotos photos={job.photos} />
          </Card>
        ) : null}

        {job.status === "completed" && job.inspection ? (
          <Card style={{ gap: 6 }}>
            <T v="title">Inspection report</T>
            {Object.entries(INSPECTION).map(([k, label]) => {
              const it = job.inspection[k];
              return it ? (
                <View key={k} style={{ gap: 2 }}>
                  <Row left={label} right={RATING[it.status]} />
                  {it.note ? <T v="hint">{it.note}</T> : null}
                </View>
              ) : null;
            })}
            {job.workNotes ? <T v="hint">Partner notes: {job.workNotes}</T> : null}
            {job.warrantyUntil ? <Notice tone="ok">Warranty: until {new Date(job.warrantyUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}{job.warrantyMilesUntil ? ` or ${job.warrantyMilesUntil.toLocaleString("en-US")} miles` : ""}, whichever comes first.</Notice> : null}
          </Card>
        ) : null}

        {job.status === "cancelled" ? <Notice>{job.cancelReason === "no_show" ? `Marked as a no-show. A ${money(job.cancelFeeCents)} fee applies.` : job.cancelFeeCents ? `Cancelled. A ${money(job.cancelFeeCents)} cancellation fee applies.` : "Cancelled. No charge."}</Notice> : null}
        {job.status === "expired" ? <Notice>No partner could take this one in time. You weren't charged. Try another time from your vehicle's prices.</Notice> : null}

        {err ? <Notice tone="bad">{err}</Notice> : null}

        {mode === "reschedule" ? (
          <Card style={{ gap: 10 }}>
            <T v="title">Pick a new time</T>
            <Chips label="Day" value={day} onChange={(d) => { setDay(d); setSlot(null); }} options={days.map((d) => [d.day, fmtDay(d.day)])} />
            <Chips label="Arrival window" value={slot} onChange={setSlot} options={daySlots.map((s) => [s, `${fmtTime(s)}–${fmtTime(s + 7_200_000)}`])} />
            <T v="hint">{job.partnerLate ? "Free, and you get a $10 credit." : rescheduleFee ? "You've used your 2 free reschedules. This one is $25." : `Free. ${job.freeReschedulesLeft} free reschedule${job.freeReschedulesLeft === 1 ? "" : "s"} left.`}</T>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button style={{ flex: 1 }} title="Keep time" variant="ghost" onPress={() => setMode(null)} />
              <Button style={{ flex: 1 }} title="Reschedule" disabled={!slot} loading={busy === "resched"}
                onPress={() => act("resched", () => call("jobAction", job.id, "reschedule", { windowStart: slot, expectedFeeCents: rescheduleFee }))} />
            </View>
          </Card>
        ) : null}

        {mode === "cancel" && job.cancelPreview ? (
          <Card style={{ gap: 10, borderColor: t.c.bad }}>
            <T v="title">Cancel this visit?</T>
            <T v="small">{job.cancelPreview.feeCents ? `${job.cancelPreview.reason} A ${money(job.cancelPreview.feeCents)} cancellation fee applies.` : "It's free to cancel now."}</T>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button style={{ flex: 1 }} title="Keep visit" variant="ghost" onPress={() => setMode(null)} />
              <Button style={{ flex: 1 }} title={job.cancelPreview.feeCents ? `Cancel · ${money(job.cancelPreview.feeCents)}` : "Cancel visit"} variant="danger" loading={busy === "cancel"} testID="confirm-cancel"
                onPress={() => act("cancel", () => call("jobAction", job.id, "cancel", { expectedFeeCents: job.cancelPreview.feeCents }))} />
            </View>
          </Card>
        ) : null}

        {!mode && open && job.status !== "in_progress" ? (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 24 }}>
            {job.kind === "scheduled" && ["requested", "awaiting_approval", "confirmed"].includes(job.status) && !job.partnerLate ? <LinkButton title="Reschedule" onPress={() => setMode("reschedule")} /> : null}
            {job.cancelPreview ? <LinkButton title="Cancel visit" onPress={() => setMode("cancel")} textStyle={{ color: t.c.bad }} /> : null}
          </View>
        ) : null}

        <Card style={{ gap: 6 }}>
          <T v="title">History</T>
          {job.timeline.slice().reverse().map((e, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <T v="hint" style={{ width: 96 }}>{fmtWhen(e.at)}</T>
              <T v="small" style={{ flex: 1 }}>{EVENT[e.kind] || e.kind}</T>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}
