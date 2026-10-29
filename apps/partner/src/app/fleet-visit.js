// One fleet visit for the partner: details and pay, claim / release / start, then each vehicle and Finish.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtLeft, fmtWindow } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, LinkButton, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { body, card, label, muted } from "../components/Onboarding";
import { fonts, p } from "../theme";

const VS = { scheduled: ["Scheduled", p.muted], checkin: ["Check-in", p.money], service: ["Servicing", p.money], done: ["Done", p.ok], skipped: ["Not serviced", p.muted] };

export default function FleetVisit() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/fleet-runs"));
  const load = useCallback(async () => { try { setR((await call("partnerFleetRun", String(id))).run); setErr(null); } catch (e) { setErr(e.message); } }, [call, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function act(action) {
    setBusy(action); setErr(null);
    try {
      const out = await call("fleetRunAction", r.id, action);
      if (action === "release") { router.replace("/fleet-runs"); return; }
      setR(out.run);
    } catch (e) { setErr(e.message); } finally { setBusy(null); setConfirm(false); }
  }
  if (!r) return <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }}><TopBar onBack={back} title="Fleet visit" />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brand} style={{ marginTop: 40 }} />}</Screen>;
  const done = r.vehicles.filter((v) => ["done", "skipped"].includes(v.status)).length;
  const all = done === r.vehicles.length;
  const now = Date.now();
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title={`Fleet visit #${r.number}`} />
      <View style={{ gap: 14 }}>
        <View style={[card, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
          <View><Text style={label}>{r.status === "completed" ? "You earned" : "Estimated earnings"}</Text><Text style={{ fontFamily: fonts.displayH, fontSize: 30, color: p.money }}>{money(r.pay.earningsCents)}</Text></View>
          <Text style={[muted, { textAlign: "right" }]}>{r.vehicles.length} vehicle{r.vehicles.length === 1 ? "" : "s"}{r.pay.partsReimbursedCents ? `\n+ ${money(r.pay.partsReimbursedCents)} parts at cost` : ""}</Text>
        </View>
        <View style={card}>
          {[["Fleet", r.fleet.name], ["When", fmtWindow(r.windowStart, r.windowEnd)], ["Yard", `${r.fleet.yard.street}, ${r.fleet.yard.city}`], ["Hours", r.fleet.yardHours], ["PO", r.po || "None"],
            ["Contact", `${r.fleet.managerName || ""}${r.fleet.managerPhone ? ` · ${r.fleet.managerPhone}` : ""}`], ["Add-ons", `Approved automatically up to ${money(r.fleet.autoApproveCents)} per vehicle`]].map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", gap: 10 }}><Text style={[label, { width: 74 }]}>{k}</Text><Text style={[body, { flex: 1 }]} selectable>{v}</Text></View>
          ))}
          {r.fleet.checkinNotes ? <Text style={[body, { color: p.money }]}>Check-in: {r.fleet.checkinNotes}</Text> : null}
          <Text style={muted}>Business yard, so the address shows now. Each vehicle needs its own 12 photos and odometer reading.</Text>
        </View>

        <Text style={label}>{r.status === "active" ? `${done} of ${r.vehicles.length} vehicle${r.vehicles.length === 1 ? "" : "s"} done` : "Vehicles"}</Text>
        {r.status === "active" ? <View style={{ height: 8, borderRadius: 5, backgroundColor: p.panel2, overflow: "hidden" }}><View style={{ width: `${(done / r.vehicles.length) * 100}%`, height: "100%", backgroundColor: p.ok }} /></View> : null}
        {r.vehicles.map((v, i) => (
          <Pressable key={v.id} disabled={r.status !== "active"} onPress={() => router.push({ pathname: "/fleet-vehicle", params: { id: r.id, rv: v.id } })} accessibilityRole="button" testID="fleet-visit-vehicle"
            style={({ pressed }) => [card, { flexDirection: "row", gap: 10, alignItems: "center", padding: 12 }, pressed && { borderColor: p.brand }]}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: v.status === "done" ? p.ok : p.panel2, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: fonts.bodyX, color: v.status === "done" ? "#03200F" : p.ink }}>{v.status === "done" ? "✓" : v.status === "skipped" ? "–" : i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[body, { fontFamily: fonts.bodyB }]}>{v.unit} · {v.year} {v.make} {v.model}</Text>
              <Text style={muted}>{v.lines.map((l) => l.name).join(", ")}{v.addons && v.addons.length ? ` · ${v.addons.length} add-on` : ""}</Text>
            </View>
            <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: VS[v.status][1] }}>{VS[v.status][0].toUpperCase()}</Text>
          </Pressable>
        ))}
        <View style={card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={body}>Labor (book time × ${r.laborRate}/hr)</Text><Text style={body}>{money(r.pay.laborCents)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={body}>Platform fee ({r.pay.feePct}% of labor)</Text><Text style={body}>−{money(r.pay.feeCents)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={body}>Trip fee</Text><Text style={body}>{money(r.pay.visitFeeCents)}</Text></View>
          {r.pay.topUpCents ? <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={body}>Minimum pay top-up</Text><Text style={body}>{money(r.pay.topUpCents)}</Text></View> : null}
        </View>

        {err ? <Notice tone="bad">{err}</Notice> : null}
        {r.status === "posted" ? <Button title="Claim this visit" big variant="money" onPress={() => act("claim")} loading={busy === "claim"} testID="fleet-claim" /> : null}
        {r.status === "claimed" ? (
          <>
            <Button title={now < r.canStartAt ? `Start opens in ${fmtLeft(r.canStartAt - now)}` : "Start fleet visit"} big variant="okb" onPress={() => act("start")} loading={busy === "start"} disabled={now < r.canStartAt} testID="fleet-start" />
            {confirm ? (
              <View style={{ gap: 8 }}>
                <Text style={muted}>{now < r.freeReleaseUntil ? "Release this visit? It's free now; it goes back out to other partners." : "Releasing inside 24 hours counts as a late cancel on your record."}</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button style={{ flex: 1 }} title="Keep it" variant="ghost" onPress={() => setConfirm(false)} />
                  <Button style={{ flex: 1 }} title="Release" variant="danger" onPress={() => act("release")} loading={busy === "release"} />
                </View>
              </View>
            ) : <LinkButton title="Release visit" onPress={() => setConfirm(true)} style={{ alignSelf: "center" }} textStyle={{ color: p.muted }} />}
          </>
        ) : null}
        {r.status === "active" ? <Button title={all ? "Finish visit & submit" : "Finish or skip every vehicle"} big variant="okb" onPress={() => act("finish")} loading={busy === "finish"} disabled={!all} testID="fleet-finish" /> : null}
        {r.status === "completed" ? <Notice tone="ok">Visit submitted. Your earnings are in your balance, and the fleet has its invoice.</Notice> : null}
      </View>
    </Screen>
  );
}
