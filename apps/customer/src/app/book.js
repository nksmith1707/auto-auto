// Book a visit: where, when, and whether to approve the partner first. Price comes from the server and is locked at booking.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { bookingDays, fmtDay, fmtTime } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Card, Checkbox, Chips, Field, Notice, Screen, T, errorParts, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

export default function Book() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const vehicleId = String(params.vehicleId || "");
  const serviceIds = useMemo(() => String(params.serviceIds || "").split(",").filter(Boolean), [params.serviceIds]);
  const { call } = useAuth();
  const [places, setPlaces] = useState(null);
  const [placeId, setPlaceId] = useState(null);
  const [quote, setQuote] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const roadsideOnly = quote && quote.lines.length > 0 && quote.lines.every((l) => l.category === "roadside");
  const [when, setWhen] = useState("scheduled");
  const days = useMemo(() => bookingDays(), []);
  const [day, setDay] = useState(days[0] ? days[0].day : null);
  const [slot, setSlot] = useState(null);
  const [approve, setApprove] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  useEffect(() => {
    call("places").then(({ places: p }) => { setPlaces(p); const d = p.find((x) => x.isDefault) || p[0]; if (d) setPlaceId(d.id); }).catch((e) => setErr(e));
    call("quote", { vehicleId, serviceIds }).then((r) => { setQuote(r.quote); setVehicle(r.vehicle); }).catch((e) => setErr(e));
  }, [call, vehicleId, serviceIds]);

  const daySlots = (days.find((d) => d.day === day) || { slots: [] }).slots;

  async function submit() {
    setErr(null);
    if (!placeId) return setErr({ message: "Add a place so your partner knows where to meet you." });
    if (when === "scheduled" && !slot) return setErr({ code: "invalid_input", fields: { windowStart: "Pick an arrival window." } });
    setBusy(true);
    try {
      const { job } = await call("book", { vehicleId, placeId, serviceIds, kind: when, windowStart: when === "scheduled" ? slot : undefined, approvePartner: approve, notes });
      router.replace({ pathname: "/job", params: { id: job.id, fresh: "1" } });
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      {!quote && !err ? <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} /> : null}
      {quote ? (
        <View style={{ gap: 18 }}>
          <View style={{ gap: 4, alignItems: "center" }}>
            <T v="h1" accessibilityRole="header">Book your visit</T>
            {vehicle ? <Text style={{ fontFamily: t.f.displayX, fontSize: 17, color: t.c.brand }}>{vehicle.year} {vehicle.make} {vehicle.model}</Text> : null}
          </View>

          <Card style={{ gap: 6 }}>
            {quote.lines.map((l) => (
              <View key={l.serviceId} style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="small">{l.name}</T><T v="small">{money(l.priceCents, { always: true })}</T></View>
            ))}
            {quote.pending.map((p) => (
              <View key={p.serviceId} style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="small">{p.name}</T><T v="hint">Quoted before ordering</T></View>
            ))}
            {quote.fees.map((f) => (
              <View key={f.id} style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="hint">{f.label}</T><T v="hint">{money(f.cents, { always: true })}</T></View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.c.line, paddingTop: 6 }}>
              <T style={{ fontFamily: t.f.displayX }}>Estimate</T><T style={{ fontFamily: t.f.displayX }}>{money(quote.totalCents, { always: true })}</T>
            </View>
          </Card>

          <View style={{ gap: 8 }}>
            <Text style={t.text.label}>Where</Text>
            {places && !places.length ? (
              <Card style={{ gap: 8 }}><T v="muted">Add a place first so your partner knows where to meet you.</T><Button title="Add a place" variant="ghost" onPress={() => router.push("/place")} /></Card>
            ) : null}
            {(places || []).map((p) => {
              const on = p.id === placeId;
              return (
                <Pressable key={p.id} onPress={() => setPlaceId(p.id)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                  style={{ borderWidth: on ? 2 : 1, borderColor: on ? t.c.brand : t.c.line, borderRadius: 14, padding: 12, backgroundColor: t.c.surface }}>
                  <T style={{ fontFamily: t.f.bodyB }}>{p.label}</T>
                  <T v="hint">{p.street}{p.unit ? `, ${p.unit}` : ""} · {p.city}</T>
                </Pressable>
              );
            })}
          </View>

          <Chips label="When" value={when} onChange={setWhen} testID="when"
            options={[["scheduled", "Schedule"], ["asap", "As soon as possible"], ...(roadsideOnly ? [["roadside", "Roadside help now"]] : [])]} />
          {when === "scheduled" ? (
            <View style={{ gap: 10 }}>
              <Chips label="Day" value={day} onChange={(d) => { setDay(d); setSlot(null); }} options={days.map((d) => [d.day, fmtDay(d.day)])} />
              <Chips label="Arrival window" value={slot} onChange={setSlot} options={daySlots.map((s) => [s, `${fmtTime(s)}–${fmtTime(s + 7_200_000)}`])} error={fields.windowStart} testID="slots" />
            </View>
          ) : (
            <Notice>{when === "roadside" ? "We look for help right away. If nobody can come within an hour, the request closes and you aren't charged." : "We look for a partner right away. If nobody can come within 4 hours, the request closes and you aren't charged."}</Notice>
          )}

          <Checkbox checked={approve} onChange={setApprove}>Let me approve my partner before they're confirmed</Checkbox>
          {approve ? <T v="hint">You'll see their rating and jobs done. You have 5 minutes to answer for same-day visits, 2 hours for later ones.</T> : null}
          <Field label="Notes for your partner (optional)" value={notes} onChangeText={setNotes} placeholder="Anything they should know about the vehicle" multiline maxLength={500} />

          <Card style={{ gap: 4 }}>
            <T v="small" style={{ fontFamily: t.f.bodyB }}>Cancel rules</T>
            <T v="hint">Free more than 48 hours before your visit. $25 inside 48 hours. $50 once your partner is on the way. 2 free reschedules.</T>
            {quote.depositCents ? <T v="hint">A {money(quote.depositCents, { always: true })} deposit applies to this booking.</T> : null}
          </Card>

          {message ? <Notice tone="bad">{message}</Notice> : null}
          <Button title={when === "scheduled" ? "Book visit" : "Request now"} onPress={submit} loading={busy} disabled={!places || !places.length} testID="book-submit" />
          <T v="hint" style={{ textAlign: "center" }}>Payments aren't connected yet, so nothing is charged.</T>
        </View>
      ) : null}
      {err && !quote ? <Notice tone="bad">{err.message}</Notice> : null}
    </Screen>
  );
}
