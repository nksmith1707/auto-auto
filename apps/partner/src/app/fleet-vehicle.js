// One vehicle on a fleet visit: check-in photos and odometer, the work and any add-ons, after photos,
// the inspection, and a note for the fleet's maintenance log. Or mark it not serviced.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Field, LinkButton, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { body, card, label, muted } from "../components/Onboarding";
import { AFTER_SLOTS, CHECKIN_SLOTS, INTERIOR_SLOTS, PhotoGrid } from "../components/Photos";
import { fonts, p } from "../theme";

const ITEMS = [["brakes", "Brakes"], ["tires", "Tires"], ["fluids", "Fluids"], ["battery", "Battery"], ["wipers", "Wipers"], ["lights", "Lights"], ["belts_hoses", "Belts & hoses"], ["filters", "Filters"]];

function Seg({ value, onChange }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[["good", "Good", p.ok], ["soon", "Soon", p.money], ["now", "Now", p.bad]].map(([v, l, c]) => {
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

export default function FleetVehicleWork() {
  const router = useRouter();
  const { id, rv } = useLocalSearchParams();
  const { call } = useAuth();
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [odo, setOdo] = useState("");
  const [insp, setInsp] = useState({});
  const [notes, setNotes] = useState("");
  const [addon, setAddon] = useState(null); // { ids: [], reason: "" }
  const [mine, setMine] = useState([]);
  const [skip, setSkip] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/fleet-visit", params: { id } }));
  const load = useCallback(async () => { try { setRun((await call("partnerFleetRun", String(id))).run); } catch (e) { setErr(e.message); } }, [call, id]);
  useFocusEffect(useCallback(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]));
  useEffect(() => { call("partnerServices").then((r) => setMine((r.services || []).filter((s) => s.offered !== false))).catch(() => {}); }, [call]);

  if (!run) return <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }}><TopBar onBack={back} title="Vehicle" />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brand} style={{ marginTop: 40 }} />}</Screen>;
  const v = run.vehicles.find((x) => x.id === rv);
  if (!v) return <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }}><TopBar onBack={back} title="Vehicle" /><Notice tone="bad">That vehicle isn't on this visit.</Notice></Screen>;
  const ph = v.photos || { checkin: [], after: [], checkinNeeded: [], afterNeeded: [], damage: [] };
  const setPhotos = (photos) => setRun((r) => ({ ...r, vehicles: r.vehicles.map((x) => (x.id === v.id ? { ...x, photos } : x)) }));
  const upload = (b) => call("fleetVehiclePhoto", run.id, v.id, b);
  const note = (slot, n) => call("fleetVehicleDamage", run.id, v.id, slot, n);
  const checkinLeft = run.photosRequired ? ph.checkinNeeded.length : 0;
  const afterLeft = run.photosRequired ? ph.afterNeeded.length : 0;
  const pending = v.addons.some((a) => a.status === "pending");
  const inspDone = ITEMS.every(([k]) => insp[k] && (insp[k].status === "good" || (insp[k].note || "").trim().length >= 3));

  async function act(name, action, b, after) {
    setBusy(name); setErr(null);
    try { const r = await call("fleetVehicleAction", run.id, v.id, action, b); setRun(r.run); if (after) after(r.run); }
    catch (e) { setErr(e.fields ? Object.values(e.fields).filter(Boolean)[0] || e.message : e.message); }
    finally { setBusy(null); }
  }
  const have = new Set([...v.lines.map((l) => l.serviceId), ...v.addons.map((a) => a.serviceId)]);

  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title={v.unit} />
      <View style={{ gap: 14 }}>
        <View style={card}>
          <Text style={{ fontFamily: fonts.displayX, fontSize: 20, color: p.ink }}>{v.year} {v.make} {v.model}</Text>
          <Text style={muted}>{v.classLabel}{v.plate ? ` · ${v.plate}` : ""}{v.vin ? ` · VIN ${v.vin}` : ""}</Text>
          <Text style={body}>{v.lines.map((l) => l.name).join(", ")}</Text>
        </View>

        {v.status === "checkin" ? (
          <View style={card}>
            <Text style={label}>Vehicle check-in · {ph.checkin.length} of 12 photos</Text>
            <Text style={muted}>Photograph every angle before touching it. Tap a photo to mark existing damage.</Text>
            <Text style={label}>360° walkaround</Text>
            <PhotoGrid slots={CHECKIN_SLOTS} photos={ph.checkin} onChange={setPhotos} allowDamage upload={upload} note={note} testPrefix="fphoto" />
            <Text style={label}>Interior</Text>
            <PhotoGrid slots={INTERIOR_SLOTS} photos={ph.checkin} onChange={setPhotos} allowDamage upload={upload} note={note} testPrefix="fphoto" />
            {ph.damage.length ? <Text style={[body, { color: p.bad }]}>Existing damage: {ph.damage.map((d) => `${d.label}: ${d.note}`).join("; ")}</Text> : null}
            <Field label="Odometer" value={odo} onChangeText={setOdo} keyboardType="number-pad" placeholder="61,900" testID="fodo" />
            <Button title={checkinLeft ? `Take ${checkinLeft} more photo${checkinLeft > 1 ? "s" : ""} to start` : odo.trim() ? "Start service" : "Enter the odometer reading"}
              onPress={() => act("checkin", "check-in", { odometer: odo })} loading={busy === "checkin"} disabled={!odo.trim() || checkinLeft > 0} testID="fcheckin" />
          </View>
        ) : null}

        {v.status === "service" ? (
          <>
            <View style={card}>
              <Text style={label}>Add-ons</Text>
              {v.addons.map((a) => (
                <Text key={a.id} style={body}>{a.name} · {money(a.priceCents)} · <Text style={{ color: a.status === "approved" ? p.ok : a.status === "pending" ? p.money : p.muted, fontFamily: fonts.bodyB }}>{a.status === "approved" ? (a.autoApproved ? "Pre-approved" : "Approved") : a.status === "pending" ? "Sent to the fleet manager" : "Declined"}</Text></Text>
              ))}
              {addon ? (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {mine.filter((s) => !have.has(s.id)).map((s) => {
                      const on = addon.ids.includes(s.id);
                      return (
                        <Pressable key={s.id} onPress={() => setAddon({ ...addon, ids: on ? addon.ids.filter((x) => x !== s.id) : [...addon.ids, s.id] })}
                          style={{ borderWidth: 1.5, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12, borderColor: on ? p.brand : p.line, backgroundColor: on ? p.brand : p.panel }}>
                          <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.ink }}>{s.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Field label="What you found" value={addon.reason} onChangeText={(x) => setAddon({ ...addon, reason: x })} placeholder="Pads at 2 mm, rotors scored" multiline testID="faddon-reason" />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Button style={{ flex: 1 }} title="Cancel" variant="ghost" onPress={() => setAddon(null)} />
                    <Button style={{ flex: 1 }} title="Send" onPress={() => act("addon", "addons", { serviceIds: addon.ids, reason: addon.reason }, () => setAddon(null))} loading={busy === "addon"} disabled={!addon.ids.length} testID="faddon-send" />
                  </View>
                </View>
              ) : <Button title={`+ Add-on (pre-approved up to ${money(run.fleet.autoApproveCents)})`} variant="ghost" onPress={() => setAddon({ ids: [], reason: "" })} testID="faddon" />}
            </View>
            <View style={card}>
              <Text style={label}>After photos</Text>
              <PhotoGrid slots={AFTER_SLOTS} photos={ph.after} onChange={setPhotos} upload={upload} note={note} testPrefix="fafter" />
            </View>
            <View style={card}>
              <Text style={label}>Inspection report</Text>
              {ITEMS.map(([k, l]) => (
                <View key={k} style={{ gap: 6 }} testID={`finsp-${k}`}>
                  <Text style={[body, { fontFamily: fonts.bodyB }]}>{l}</Text>
                  <Seg value={insp[k] && insp[k].status} onChange={(st) => setInsp({ ...insp, [k]: { ...(insp[k] || {}), status: st } })} />
                  {insp[k] && insp[k].status !== "good" ? <Field label="Note" value={insp[k].note || ""} onChangeText={(n) => setInsp({ ...insp, [k]: { ...insp[k], note: n } })} /> : null}
                </View>
              ))}
              <Field label="Note for the fleet's maintenance log" value={notes} onChangeText={setNotes} multiline placeholder="Work done, parts used, anything due next" testID="fnotes" />
            </View>
            <Button title={pending ? "Waiting on the fleet manager" : afterLeft ? "Take both after photos" : !inspDone ? "Finish the inspection" : "Vehicle done"} big variant="okb"
              onPress={() => act("done", "done", { inspection: insp, notes }, () => back())} loading={busy === "done"} disabled={pending || afterLeft > 0 || !inspDone || notes.trim().length < 10} testID="fdone" />
          </>
        ) : null}

        {["done", "skipped"].includes(v.status) ? <Notice tone={v.status === "done" ? "ok" : "info"}>{v.status === "done" ? `Done. Odometer ${v.odometer != null ? v.odometer.toLocaleString("en-US") : "—"}, saved to the fleet's maintenance log.` : `Marked not serviced: ${v.skipReason}`}</Notice> : null}

        {["checkin", "service"].includes(v.status) ? (
          skip != null ? (
            <View style={card}>
              <Field label="Why can't you service it?" value={skip} onChangeText={setSkip} placeholder="Not in the yard, or not safe to work on" testID="fskip-reason" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button style={{ flex: 1 }} title="Back" variant="ghost" onPress={() => setSkip(null)} />
                <Button style={{ flex: 1 }} title="Mark not serviced" variant="danger" onPress={() => act("skip", "skip", { reason: skip }, () => back())} loading={busy === "skip"} testID="fskip" />
              </View>
            </View>
          ) : <LinkButton title="Vehicle not here or not safe to work on?" onPress={() => setSkip("")} style={{ alignSelf: "center" }} textStyle={{ color: p.muted }} />
        ) : null}
        {err ? <Notice tone="bad">{err}</Notice> : null}
      </View>
    </Screen>
  );
}
