// A fleet invoice: lines, total, due date, and paying by card.
import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Card, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { Pill } from "../components/Fleet";

export default function FleetInvoice() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [i, setI] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/fleet"));
  useFocusEffect(useCallback(() => { call("fleetInvoice", String(id)).then((r) => setI(r.invoice)).catch((e) => setErr(e.message)); }, [call, id]));
  if (!i) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  async function pay() {
    setBusy(true); setErr(null);
    try { setI((await call("payFleetInvoice", i.id)).invoice); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 14 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <T v="h1" accessibilityRole="header">INV-{i.number}</T>
          <Pill tone={i.status === "paid" ? "ok" : i.pastDue ? "bad" : "warn"} testID="invoice-status">{i.status === "paid" ? "Paid" : i.pastDue ? "Past due" : "Open"}</Pill>
        </View>
        <T v="muted" style={{ textAlign: "center" }}>{i.fleet.name} · {i.po || "No PO"} · issued {day(i.issuedAt)}, due {day(i.dueAt)}</T>
        <Card style={{ gap: 6 }}>
          {i.lines.map((l, n) => (
            <View key={n} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}><T v="small" style={{ flex: 1 }}>{l.label}</T><T v="small">{money(l.cents, { always: true })}</T></View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.c.line, paddingTop: 6 }}>
            <T style={{ fontFamily: t.f.displayX }}>Total</T><T style={{ fontFamily: t.f.displayX }}>{money(i.totalCents, { always: true })}</T>
          </View>
        </Card>
        <T v="hint">Labor at the fleet rate by book time, parts at cost + 10%. Each vehicle's photos, inspection, and notes are in its maintenance log.</T>
        {i.paidNote ? <Notice tone="ok">{i.paidNote}</Notice> : null}
        {i.paymentError && i.status === "open" ? <Notice tone="bad">{i.paymentError}</Notice> : null}
        {i.status === "open" ? (
          <>
            <Button title={`Pay ${money(i.totalCents, { always: true })} with your card`} onPress={pay} loading={busy} testID="invoice-pay" />
            <T v="hint" style={{ textAlign: "center" }}>Or pay by check or ACH; we'll mark it paid when it arrives.</T>
          </>
        ) : null}
        {err ? <Notice tone="bad">{err}</Notice> : null}
      </View>
    </Screen>
  );
}
