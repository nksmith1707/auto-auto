// One job from the partner's side: accept, start trip (address unlocks), arrive, check in, add-ons, glass quote, inspection, complete.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtLeft, fmtWhen, fmtWindow } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Checkbox, Field, LinkButton, Notice, Screen, T } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { AFTER_SLOTS, CHECKIN_SLOTS, INTERIOR_SLOTS, PhotoGrid } from "../components/Photos";
import { fonts, p } from "../theme";

const LABEL = {
  requested: "Open job", awaiting_approval: "Waiting for the customer", confirmed: "Confirmed", en_route: "On the way", arrived: "Arrived",
  in_progress: "Working", completed: "Completed", cancelled: "Cancelled", expired: "Closed",
};
const PARK = { driveway: "Driveway", street: "Street parking", lot: "Parking lot", garage: "Garage", other: "Other" };

function Box({ children, style, accent }) {
  return <View style={[{ backgroundColor: p.panel, borderWidth: accent ? 2 : 1, borderColor: accent ? p.brand : p.line, borderRadius: 18, padding: 16, gap: 8 }, style]}>{children}</View>;
}
const Label = ({ children }) => <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" }}>{children}</Text>;
const Line = ({ l, r, strong, color }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
    <Text style={{ flex: 1, fontFamily: strong ? fonts.bodyX : fonts.body, fontSize: 14, color: p.ink }}>{l}</Text>
    <Text style={{ fontFamily: strong ? fonts.displayX : fonts.bodyB, fontSize: strong ? 17 : 14, color: color || p.ink }}>{r}</Text>
  </View>
);

function Seg({ value, onChange, options }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {options.map(([v, l, c]) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ checked: on }}
            style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: on ? c : p.line, backgroundColor: on ? `${c}22` : "transparent" }}>
            <Text style={{ fontFamily: fonts.bodyX, fontSize: 13, color: on ? c : p.muted }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PartnerJob() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [job, setJob] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [odo, setOdo] = useState("");
  const [panel, setPanel] = useState(null); // "addon" | "glass" | "cancel"
  const [catalog, setCatalog] = useState(null);
  const [addon, setAddon] = useState({ ids: [], reason: "" });
  const [glass, setGlass] = useState({ cost: "", partNumber: "", supplier: "", note: "", cal: false });
  const [inspection, setInspection] = useState({});
  const [notes, setNotes] = useState("");
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  const load = useCallback(async () => {
    try { setJob((await call("job", id)).job); setErr(null); } catch (e) { setErr(e.message); }
  }, [call, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(() => { load(); setNowTick(Date.now()); }, 15000); return () => clearInterval(i); }, [load]);
  useEffect(() => { if (panel === "addon" && !catalog) call("partnerServices").then((r) => setCatalog(r.services)).catch(() => {}); }, [panel, catalog, call]);

  async function act(name, fn, after) {
    setErr(null);
    setBusy(name);
    try {
      const r = await fn();
      if (r && r.job) setJob(r.job); else await load();
      setPanel(null);
      if (after) after(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }
  const go = (action, body, after) => act(action, () => call("jobAction", job.id, action, body), after);

  const glassPending = useMemo(() => (job ? job.pendingQuotes.filter((q) => q.reason === "quote_needed" && !(job.addons || []).some((a) => a.serviceId === q.serviceId && ["pending", "approved"].includes(a.status))) : []), [job]);

  if (!job) {
    return (
      <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }}>
        <TopBar onBack={back} title="Job" />
        {err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brandText} style={{ marginTop: 40 }} />}
      </Screen>
    );
  }

  const s = job.status;
  const startAt = job.canStartTripAt;
  const ph = job.photos || { checkin: [], after: [], checkinNeeded: [], afterNeeded: [] };
  const setPhotos = (photos) => setJob((j) => ({ ...j, photos }));
  const checkinLeft = job.photosRequired ? ph.checkinNeeded.length : 0;
  const afterLeft = job.photosRequired ? ph.afterNeeded.length : 0;
  const inspDone = (job.inspectionItems || []).every((it) => inspection[it.key] && (inspection[it.key].status === "good" || (inspection[it.key].note || "").trim().length >= 3));

  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title={LABEL[s]} />
      <View style={{ gap: 14 }}>
        <View style={{ gap: 4 }}>
          <T v="h1" accessibilityRole="header">{job.services.map((x) => x.name).concat(job.pendingQuotes.map((x) => x.name)).join(", ")}</T>
          <T v="muted">{job.vehicle.year} {job.vehicle.make} {job.vehicle.model}{job.vehicle.trim ? ` ${job.vehicle.trim}` : ""} · {job.customer.name}</T>
          <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.ink }}>{job.kind === "scheduled" ? fmtWindow(job.windowStart, job.windowEnd) : job.kind === "roadside" ? "Roadside · now" : "As soon as possible"}</Text>
        </View>

        <Box>
          <Label>{job.place ? "Address" : "Area"}</Label>
          {job.place ? (
            <>
              <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.ink }} selectable>{job.place.street}{job.place.unit ? `, ${job.place.unit}` : ""}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.muted }}>{job.place.city}, {job.place.state} {job.place.zip}{job.parking ? ` · ${PARK[job.parking]}` : ""}</Text>
              {job.place.notes ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.money }}>Note: {job.place.notes}</Text> : null}
            </>
          ) : (
            <>
              <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.ink }}>{job.area}</Text>
              {job.distanceMiles != null ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.brandText }}>{job.distanceMiles} miles away · about {job.driveMinutes} min</Text> : null}
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>The exact address unlocks when you tap Start trip.</Text>
            </>
          )}
          {job.notes ? <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink }}>Customer note: "{job.notes}"</Text> : null}
        </Box>

        <Box>
          <Label>{s === "completed" ? "You earned" : "You'll earn"}</Label>
          {(s === "completed" && job.final ? [job.final.partnerPay] : [job.pay]).map((pay, i) => (
            <View key={i} style={{ gap: 4 }}>
              <Line l="Labor (book time)" r={money(pay.laborCents, { always: true })} />
              <Line l={`Platform fee (${pay.feePct}% of labor)`} r={money(-pay.feeCents, { always: true })} />
              <Line l="Mobile fee" r={money(pay.visitFeeCents, { always: true })} />
              {pay.topUpCents ? <Line l="Minimum visit top-up" r={money(pay.topUpCents, { always: true })} /> : null}
              <Line l="Your earnings" r={money(pay.earningsCents, { always: true })} strong color={p.money} />
              {pay.partsReimbursedCents ? <Line l="Parts reimbursed at cost (separate)" r={money(pay.partsReimbursedCents, { always: true })} /> : null}
            </View>
          ))}
          {job.vehicle.oilPreference ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Oil preference: {job.vehicle.oilPreference}</Text> : null}
        </Box>

        {err ? <Notice tone="bad">{err}</Notice> : null}

        {s === "requested" ? (
          <View style={{ gap: 8 }}>
            <Button title="Accept job" big onPress={() => go("accept")} loading={busy === "accept"} testID="accept-job" />
          </View>
        ) : null}
        {["confirmed", "en_route", "arrived", "in_progress"].includes(s) ? (
          <Button title={`Message ${job.customer.name.split(" ")[0]}`} variant="ghost" onPress={() => router.push({ pathname: "/chat", params: { id: job.id, name: job.customer.name } })} testID="open-chat" />
        ) : null}
        {s === "awaiting_approval" ? <Notice>Waiting for the customer to confirm you. They have {fmtLeft(job.approvalDeadline - nowTick)} to answer.</Notice> : null}

        {s === "confirmed" ? (
          <View style={{ gap: 8 }}>
            <Button title="Start trip" big onPress={() => go("start-trip")} loading={busy === "start-trip"} disabled={nowTick < startAt} testID="start-trip" />
            {nowTick < startAt ? <T v="hint" style={{ textAlign: "center" }}>You can start the trip {fmtWhen(startAt)}, 3 hours before the window.</T> : <T v="hint" style={{ textAlign: "center" }}>The exact address unlocks when you start.</T>}
          </View>
        ) : null}
        {s === "en_route" ? <Button title="I've arrived" big onPress={() => go("arrive")} loading={busy === "arrive"} testID="arrived" /> : null}

        {s === "arrived" ? (
          <Box accent>
            <Label>Vehicle check-in</Label>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink }}>Walk around the {job.vehicle.make} {job.vehicle.model} and photograph every angle before touching it. Tap a photo after taking it to mark existing damage.</Text>
            <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, color: p.muted }} testID="checkin-count">{ph.checkin.length} OF 12 PHOTOS</Text>
            <View style={{ height: 8, borderRadius: 5, backgroundColor: p.panel2, overflow: "hidden" }}><View style={{ width: `${(ph.checkin.length / 12) * 100}%`, height: "100%", backgroundColor: p.ok }} /></View>
            <Label>360° walkaround</Label>
            <PhotoGrid jobId={job.id} slots={CHECKIN_SLOTS} photos={ph.checkin} onChange={setPhotos} allowDamage />
            <Label>Interior</Label>
            <PhotoGrid jobId={job.id} slots={INTERIOR_SLOTS} photos={ph.checkin} onChange={setPhotos} allowDamage />
            {ph.damage && ph.damage.length ? (
              <View style={{ backgroundColor: p.badSoft, borderRadius: 12, padding: 10 }}>
                <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.ink }}>Existing damage noted: {ph.damage.map((d) => `${d.label}: ${d.note}`).join("; ")}. The customer sees this in their service record.</Text>
              </View>
            ) : null}
            <Field label="Odometer" value={odo} onChangeText={setOdo} keyboardType="number-pad" placeholder="84,500" testID="odometer" />
            <Button title={checkinLeft ? `Take ${checkinLeft} more photo${checkinLeft > 1 ? "s" : ""} to start` : odo.trim() ? "Start work" : "Enter the odometer reading"}
              onPress={() => go("check-in", { odometer: odo })} loading={busy === "check-in"} disabled={!odo.trim() || checkinLeft > 0} testID="check-in" />
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>Photos are time-stamped. They protect you if there's a damage claim later.</Text>
            {nowTick >= job.noShowAllowedAt ? (
              <LinkButton title="Customer not here? Mark no-show" onPress={() => go("no-show")} style={{ alignSelf: "center" }} textStyle={{ color: p.bad }} />
            ) : (
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted, textAlign: "center" }}>Customer not here? Call and text through the app. No-show unlocks in {fmtLeft(job.noShowAllowedAt - nowTick)}; they pay the $50 fee and you keep $40.</Text>
            )}
          </Box>
        ) : null}

        {glassPending.length && ["confirmed", "en_route", "arrived", "in_progress"].includes(s) ? (
          panel === "glass" ? (
            <Box accent>
              <Label>Glass quote · {glassPending[0].name}</Label>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Look up the glass for this VIN{job.vehicle.vin ? ` (…${job.vehicle.vin.slice(-6)})` : ""}. Nothing is ordered until the customer approves.</Text>
              <Field label="Your glass cost ($)" value={glass.cost} onChangeText={(v) => setGlass({ ...glass, cost: v })} keyboardType="decimal-pad" placeholder="289.50" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field style={{ flex: 1 }} label="Part number" value={glass.partNumber} onChangeText={(v) => setGlass({ ...glass, partNumber: v })} autoCapitalize="characters" />
                <Field style={{ flex: 1 }} label="Supplier" value={glass.supplier} onChangeText={(v) => setGlass({ ...glass, supplier: v })} autoCapitalize="words" />
              </View>
              {glassPending[0].serviceId === "glass_windshield" ? <Checkbox checked={glass.cal} onChange={(v) => setGlass({ ...glass, cal: v })}>Needs camera calibration (adds 2.5 hr)</Checkbox> : null}
              <Field label="Note (required above the typical price)" value={glass.note} onChangeText={(v) => setGlass({ ...glass, note: v })} multiline />
              <Button title="Send quote to customer" onPress={() => go("glass-quote", { serviceId: glassPending[0].serviceId, glassCost: glass.cost, partNumber: glass.partNumber, supplier: glass.supplier, needsCalibration: glass.cal, note: glass.note })} loading={busy === "glass-quote"} />
              <LinkButton title="Not now" onPress={() => setPanel(null)} style={{ alignSelf: "center" }} />
            </Box>
          ) : <Button title={`Send glass quote · ${glassPending[0].name}`} variant="money" onPress={() => setPanel("glass")} />
        ) : null}

        {(job.addons || []).length ? (
          <Box>
            <Label>Add-ons and quotes</Label>
            {job.addons.map((a) => (
              <Line key={a.id} l={`${a.line.name}${a.kind === "glass" ? " (glass)" : ""}`} r={`${money(a.line.priceCents)} · ${{ pending: "waiting", approved: "approved", declined: "declined", expired: "no answer" }[a.status]}`}
                color={a.status === "approved" ? p.ok : a.status === "pending" ? p.money : p.muted} />
            ))}
          </Box>
        ) : null}

        {s === "in_progress" ? (
          <>
            {panel === "addon" ? (
              <Box accent>
                <Label>Ask to add work</Label>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Priced from the labor guide. The customer approves or declines in the app. If they don't answer, finish the original job only.</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {(catalog || []).filter((x) => !job.services.some((j) => j.serviceId === x.id) && !["glass", "fleet"].includes(x.category)).map((x) => {
                    const on = addon.ids.includes(x.id);
                    return (
                      <Pressable key={x.id} onPress={() => setAddon({ ...addon, ids: on ? addon.ids.filter((y) => y !== x.id) : [...addon.ids, x.id] })} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                        style={{ borderWidth: 1.5, borderColor: on ? p.brand : p.line, backgroundColor: on ? p.brandSoft : "transparent", borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12 }}>
                        <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: on ? p.brandText : p.ink }}>{x.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Field label="What you found" value={addon.reason} onChangeText={(v) => setAddon({ ...addon, reason: v })} placeholder="Front pads at 2 mm, rotors scored" multiline testID="addon-reason" />
                <Button title="Send to customer" onPress={() => go("addons", { serviceIds: addon.ids, reason: addon.reason }, () => setAddon({ ids: [], reason: "" }))} loading={busy === "addons"} disabled={!addon.ids.length} testID="send-addon" />
                <LinkButton title="Not now" onPress={() => setPanel(null)} style={{ alignSelf: "center" }} />
              </Box>
            ) : <Button title="Ask to add work" variant="ghost" onPress={() => setPanel("addon")} testID="open-addon" />}

            <Box>
              <Label>Inspection report</Label>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Required before Complete. It goes into the vehicle's service history. Add a note for anything not Good.</Text>
              {(job.inspectionItems || []).map((it) => {
                const v = inspection[it.key] || {};
                return (
                  <View key={it.key} style={{ gap: 6, paddingVertical: 4 }} testID={`insp-${it.key}`}>
                    <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.ink }}>{it.label}</Text>
                    <Seg value={v.status} onChange={(st) => setInspection({ ...inspection, [it.key]: { ...v, status: st } })}
                      options={[["good", "Good", p.ok], ["soon", "Soon", p.money], ["now", "Now", p.bad]]} />
                    {v.status && v.status !== "good" ? <Field label="Note" value={v.note || ""} onChangeText={(n) => setInspection({ ...inspection, [it.key]: { ...v, note: n } })} placeholder="What you saw" /> : null}
                  </View>
                );
              })}
              <Field label="Products used and notes (optional)" value={notes} onChangeText={setNotes} placeholder="5 qt 0W-20 full synthetic, filter PH7317" multiline />
            </Box>
            <Box>
              <Label>After photos (required)</Label>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Show the finished work and the condition you left the vehicle in.</Text>
              <PhotoGrid jobId={job.id} slots={AFTER_SLOTS} photos={ph.after} onChange={setPhotos} testPrefix="after" />
            </Box>
            <Button title="Complete job" big variant="okb" onPress={() => go("complete", { inspection, notes })} loading={busy === "complete"} disabled={!inspDone || afterLeft > 0} testID="complete-job" />
            {afterLeft ? <T v="hint" style={{ textAlign: "center" }}>Take both after photos to complete.</T> : !inspDone ? <T v="hint" style={{ textAlign: "center" }}>Finish all 8 inspection items to complete.</T> : null}
          </>
        ) : null}

        {s === "completed" ? <Notice tone="ok">Done. Your earnings are added to your balance. See Payouts for when they're paid.</Notice> : null}
        {s === "cancelled" ? <Notice>{job.cancelReason === "no_show" ? `No-show recorded. You keep ${money(job.partnerCompCents)}.` : job.partnerCompCents ? `The customer cancelled. You keep ${money(job.partnerCompCents)} of their fee.` : "This job was cancelled."}</Notice> : null}

        {["en_route", "arrived", "in_progress", "completed"].includes(s) ? (
          <LinkButton title="Report damage or an incident" onPress={() => router.push({ pathname: "/incident", params: { jobId: job.id } })} style={{ alignSelf: "center" }} textStyle={{ color: p.money }} />
        ) : null}

        {["awaiting_approval", "confirmed", "en_route"].includes(s) ? (
          panel === "cancel" ? (
            <Box style={{ borderColor: p.bad }}>
              <Text style={{ fontFamily: fonts.bodyB, fontSize: 15, color: p.ink }}>Cancel this job?</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>
                {nowTick < job.freeCancelUntil ? "It's free to cancel now. The job goes back out to other partners." : "This is a late cancel: it counts on your record and the customer gets a $15 credit. 3 late cancels in 30 days starts an account review."}
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button style={{ flex: 1 }} title="Keep job" variant="ghost" onPress={() => setPanel(null)} />
                <Button style={{ flex: 1 }} title="Cancel job" variant="danger" loading={busy === "cancel"} onPress={() => act("cancel", () => call("jobAction", job.id, "cancel", {}), () => router.replace("/home"))} />
              </View>
            </Box>
          ) : <LinkButton title="Cancel job" onPress={() => setPanel("cancel")} style={{ alignSelf: "center" }} textStyle={{ color: p.muted }} />
        ) : null}
      </View>
    </Screen>
  );
}
