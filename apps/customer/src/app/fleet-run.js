// One fleet visit: status, partner, each vehicle's progress, add-ons, the invoice, and cancelling.
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtWindow } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Card, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { VisitPhotos } from "../components/Photos";
import { Pill, RUN_STATUS } from "../components/Fleet";

const STEPS = [["posted", "Posted"], ["claimed", "Partner confirmed"], ["active", "In progress"], ["completed", "Done & invoiced"]];
const V_STATUS = { scheduled: ["Scheduled", "muted"], checkin: ["Checking in", "warn"], service: ["Being serviced", "warn"], done: ["Done", "ok"], skipped: ["Not serviced", "muted"] };

export default function FleetRun() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/fleet"));
  const load = useCallback(async () => { try { setR((await call("fleetRun", String(id))).run); } catch (e) { setErr(e.message); } }, [call, id]);
  useFocusEffect(useCallback(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]));
  if (!r) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  const idx = STEPS.findIndex((s) => s[0] === r.status);
  async function cancel() {
    setBusy(true);
    try { setR((await call("cancelFleetRun", r.id, { expectedFeeCents: r.cancelPreview.feeCents })).run); setConfirm(false); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 14 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <T v="h1" accessibilityRole="header">Visit #{r.number}</T>
          <Pill tone={RUN_STATUS[r.status][1]} testID="run-status">{RUN_STATUS[r.status][0]}</Pill>
        </View>
        {r.status !== "cancelled" ? (
          <View style={{ flexDirection: "row", gap: 4 }}>
            {STEPS.map(([k, l], i) => (
              <View key={k} style={{ flex: 1, gap: 4 }}>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: i < idx ? t.c.okText : i === idx ? t.c.brand : t.c.line }} />
                <Text style={{ fontSize: 10.5, fontFamily: t.f.bodyB, color: i <= idx ? t.c.ink : t.c.muted, textAlign: "center" }}>{l}</Text>
              </View>
            ))}
          </View>
        ) : <Notice>Cancelled. {r.cancelFeeCents ? `${money(r.cancelFeeCents, { always: true })} trip fee charged (cancelled inside 24 hours).` : "No charge."}</Notice>}
        <Card style={{ gap: 4 }}>
          {[["When", fmtWindow(r.windowStart, r.windowEnd)], ["Partner", r.partner ? r.partner.name : "Waiting for a fleet partner"], ["Services", r.services.map((s) => s.name).join(", ")], ["PO", r.po || "None"],
            [r.invoice ? "Invoiced" : "Estimate", money(r.invoice ? r.invoice.totalCents : r.estimateCents, { always: true })]].map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}><T v="small">{k}</T><T v="small" style={{ fontFamily: t.f.bodyB, flexShrink: 1, textAlign: "right" }}>{v}</T></View>
          ))}
        </Card>
        <T v="title">Vehicles</T>
        {r.vehicles.map((v) => (
          <Card key={v.id} style={{ gap: 6 }} testID="run-vehicle">
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <T style={{ fontFamily: t.f.bodyX }}>{v.unit}</T>
              <Pill tone={V_STATUS[v.status][1]}>{V_STATUS[v.status][0]}</Pill>
            </View>
            <T v="small">{v.lines.map((l) => l.name).join(", ")} · {money(v.subtotalCents, { always: true })}</T>
            {v.skipped.length ? <T v="hint">Skips {v.skipped.map((x) => x.name).join(", ")} (doesn't fit a {v.classLabel.toLowerCase()})</T> : null}
            {v.addons.map((a) => <T key={a.id} v="hint">Add-on: {a.name} · {money(a.priceCents, { always: true })} · {a.status === "pending" ? "waiting for you (Approvals)" : a.status}{a.autoApproved ? " automatically" : ""}</T>)}
            {v.skipReason ? <T v="hint">Not serviced: {v.skipReason}</T> : null}
            {v.notes ? <T v="small">“{v.notes}”</T> : null}
            {v.status === "done" ? <VisitPhotos photos={v.photos} /> : null}
          </Card>
        ))}
        {r.invoice ? <Button title={`View invoice INV-${r.invoice.number}`} onPress={() => router.push({ pathname: "/fleet-invoice", params: { id: r.invoice.id } })} testID="run-invoice" /> : null}
        {r.cancelPreview ? (
          confirm ? (
            <Card style={{ gap: 8 }}>
              <T v="small">{r.cancelPreview.feeCents ? `Cancel inside 24 hours? The ${money(r.cancelPreview.feeCents, { always: true })} trip fee is charged because your partner already planned the trip.` : "Cancel this visit? It's free."}</T>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button style={{ flex: 1 }} title="Keep it" variant="ghost" onPress={() => setConfirm(false)} />
                <Button style={{ flex: 1 }} title="Cancel visit" variant="danger" onPress={cancel} loading={busy} testID="run-cancel-confirm" />
              </View>
            </Card>
          ) : <Button title="Cancel visit" variant="ghost" onPress={() => setConfirm(true)} testID="run-cancel" />
        ) : null}
        {err ? <Notice tone="bad">{err}</Notice> : null}
      </View>
    </Screen>
  );
}
