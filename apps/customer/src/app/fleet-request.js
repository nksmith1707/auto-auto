// Request fleet service: pick vehicles and services, a day and arrival window, and a PO. Shows the estimate as you go.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { bookingDays, fmtDay, fmtTime } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Card, Chips, Field, LinkButton, Notice, Screen, T, errorParts, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { MultiChips } from "../components/Fleet";

export default function FleetRequest() {
  const t = useTheme();
  const router = useRouter();
  const { call } = useAuth();
  const [d, setD] = useState(null);
  const [vehicleIds, setVehicleIds] = useState([]);
  const [serviceIds, setServiceIds] = useState(["oil_change"]);
  const days = useMemo(() => bookingDays(), []);
  const [day, setDay] = useState(days[1] ? days[1].day : days[0] && days[0].day);
  const [slot, setSlot] = useState(null);
  const [po, setPo] = useState("");
  const [est, setEst] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/fleet"));
  useEffect(() => { call("fleet").then(setD).catch((e) => setErr(e)); }, [call]);
  useEffect(() => {
    if (!vehicleIds.length || !serviceIds.length) { setEst(null); return; }
    let live = true;
    call("fleetEstimate", { vehicleIds, serviceIds }).then((r) => live && setEst(r.estimate)).catch(() => {});
    return () => { live = false; };
  }, [call, vehicleIds, serviceIds]);

  async function post() {
    setErr(null);
    if (!slot) return setErr({ code: "invalid_input", fields: { windowStart: "Pick an arrival window." } });
    setBusy(true);
    try {
      const { run } = await call("postFleetRun", { vehicleIds, serviceIds, windowStart: slot, po });
      router.replace({ pathname: "/fleet-run", params: { id: run.id } });
    } catch (e) { setErr(e); setBusy(false); }
  }

  if (!d) return <Screen><TopBar onBack={back} /><ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} /></Screen>;
  const f = d.fleet;
  const daySlots = (days.find((x) => x.day === day) || { slots: [] }).slots;
  const { message, fields } = errorParts(err);
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>Request fleet service</T>
        <View style={{ gap: 6 }}>
          <MultiChips label="Vehicles" value={vehicleIds} onChange={setVehicleIds} testID="fr-vehicles"
            options={d.vehicles.map((v) => [v.id, `${v.unit}${v.status !== "ok" ? (v.status === "due" ? " · due" : " · overdue") : ""}`])} />
          <LinkButton title="Select everything due" onPress={() => setVehicleIds(d.vehicles.filter((v) => v.status !== "ok").map((v) => v.id))} style={{ alignSelf: "flex-start" }} />
          {fields.vehicleIds ? <T v="hint" style={{ color: t.c.bad }}>{fields.vehicleIds}</T> : null}
        </View>
        <MultiChips label="Services for each vehicle" value={serviceIds} onChange={setServiceIds} options={d.services.map((s) => [s.id, s.name])} testID="fr-services" />
        <Chips label="Day" value={day} onChange={(x) => { setDay(x); setSlot(null); }} options={days.map((x) => [x.day, fmtDay(x.day)])} />
        <Chips label="Arrival window" value={slot} onChange={setSlot} options={daySlots.map((s) => [s, `${fmtTime(s)}–${fmtTime(s + 7_200_000)}`])} error={fields.windowStart} testID="fr-slots" />
        <Field label={`PO number${f.poRequired ? "" : " (optional)"}`} value={po} onChangeText={setPo} error={fields.po} autoCapitalize="characters" testID="fr-po" />
        <Card style={{ gap: 6 }} testID="fr-estimate">
          <T v="title">Estimate</T>
          {!est ? <T v="muted">Pick vehicles and services to see the estimate.</T> : (
            <>
              {est.vehicles.map((v) => (
                <View key={v.vehicleId} style={{ gap: 2 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <T v="small" style={{ flex: 1 }}>{v.unit} · {v.lines.map((l) => l.name).join(", ") || "no services that fit"}</T>
                    <T v="small">{money(v.subtotalCents, { always: true })}</T>
                  </View>
                  {v.skipped.length ? <T v="hint">Skips {v.skipped.map((x) => x.name).join(", ")}: not for a {v.classLabel.toLowerCase()}</T> : null}
                </View>
              ))}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="hint">Trip fee (one per visit)</T><T v="hint">{money(est.tripFeeCents, { always: true })}</T></View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.c.line, paddingTop: 6 }}>
                <T style={{ fontFamily: t.f.displayX }}>Total</T><T style={{ fontFamily: t.f.displayX }} testID="fr-total">{money(est.totalCents, { always: true })}</T>
              </View>
            </>
          )}
        </Card>
        <T v="hint">Book time × ${f.laborRate}/hr, parts at cost + {d.rates.partsMarkupPct}%. Add-ons up to {money(f.autoApproveCents, { always: true })} per vehicle are approved automatically. You get one invoice, {f.terms === "net30" ? "net 30" : "charged to your card"}.</T>
        {message ? <Notice tone="bad">{message}</Notice> : null}
        <Button title={est ? `Post request · ${money(est.totalCents, { always: true })}` : "Post request"} onPress={post} loading={busy} disabled={!vehicleIds.length || !serviceIds.length} testID="fr-post" />
      </View>
    </Screen>
  );
}
