// Prices for one vehicle, from the server's pricing engine. Tap services to build an estimate for one visit.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Card, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

function detail(i) {
  if (i.quoted) return `Quoted for your exact vehicle · typical ${money(i.typicalCents[0])}–${money(i.typicalCents[1])}`;
  if (i.kind === "book") return `${i.hours} hr book time${i.partsPriceCents ? ` · parts ${money(i.partsPriceCents)}` : ""}`;
  if (i.kind === "quick") return `Flat rate${i.partsPriceCents ? ` · parts ${money(i.partsPriceCents, { always: true })}` : ""}`;
  if (i.kind === "diag") return `Credited if you approve the repair within ${i.creditDays} days`;
  return "Set price";
}

export default function Prices() {
  const t = useTheme();
  const router = useRouter();
  const { vehicleId } = useLocalSearchParams();
  const { call } = useAuth();
  const [menu, setMenu] = useState(null);
  const [err, setErr] = useState(null);
  const [picked, setPicked] = useState([]);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  useEffect(() => {
    call("priceMenu", { vehicleId }).then(setMenu).catch((e) => setErr(e.message));
  }, [call, vehicleId]);

  const refreshQuote = useCallback(async (ids) => {
    if (!ids.length) { setQuote(null); return; }
    setQuoting(true);
    try { setQuote((await call("quote", { vehicleId, serviceIds: ids })).quote); setErr(null); }
    catch (e) { setErr(e.message); }
    finally { setQuoting(false); }
  }, [call, vehicleId]);

  function toggle(id) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    refreshQuote(next);
  }

  const groups = useMemo(() => (menu ? menu.categories.map((c) => ({ ...c, items: menu.items.filter((i) => i.category === c.id) })).filter((g) => g.items.length) : []), [menu]);
  const v = menu && menu.vehicle;

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      {!menu && !err ? <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} /> : null}
      {err && !menu ? <Notice tone="bad">{err}</Notice> : null}
      {menu ? (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 6, alignItems: "center" }}>
            <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>Prices</T>
            {v ? <Text style={{ fontFamily: t.f.displayX, fontSize: 17, color: t.c.brand, textAlign: "center" }} numberOfLines={1}>{`${v.year} ${v.make} ${v.model}`}</Text> : null}
            <T v="muted" style={{ textAlign: "center" }}>Fair, guaranteed prices: standard book time × {money(menu.fees.laborRate * 100)}/hr plus parts. Local shops charge about {money(menu.fees.shopLaborRate * 100)}/hr.</T>
          </View>
          <Notice>Every at-home visit adds one {money(menu.fees.mobileCents)} mobile fee, no matter how many services, plus {money(menu.fees.protectionCents)} service protection. Tap services to see a total.</Notice>

          {groups.map((g) => (
            <Card key={g.id} style={{ paddingVertical: 6, gap: 0 }}>
              <Text style={[t.text.label, { paddingTop: 8, paddingBottom: 4, textTransform: "uppercase", letterSpacing: 0.7 }]}>{g.name}</Text>
              {g.items.map((i, k) => {
                const on = picked.includes(i.serviceId);
                return (
                  <Pressable key={i.serviceId} onPress={() => toggle(i.serviceId)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    accessibilityLabel={`${i.name}, ${i.priceCents != null ? money(i.priceCents) : "quoted"}`} testID={`price-${i.serviceId}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: k ? 1 : 0, borderTopColor: t.c.line }}>
                    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? t.c.brand : t.c.line, backgroundColor: on ? t.c.brand : "transparent", alignItems: "center", justifyContent: "center" }}>
                      {on ? <Text style={{ color: "#fff", fontFamily: t.f.bodyX, fontSize: 13, lineHeight: 16 }}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[t.text.body, { fontFamily: t.f.bodyB }]}>{i.name}</Text>
                      <Text style={t.text.hint}>{detail(i)}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontFamily: t.f.displayX, fontSize: 17, color: i.priceCents != null ? t.c.ink : t.c.muted }}>{i.priceCents != null ? money(i.priceCents) : "Quote"}</Text>
                      {i.shopPriceCents ? <Text style={[t.text.hint, { textDecorationLine: "line-through" }]}>shop {money(i.shopPriceCents)}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          ))}

          <T v="hint" style={{ textAlign: "center" }}>Book times are standard estimates for now and may change slightly for your exact engine.</T>

          {picked.length ? (
            <Card style={{ gap: 8, borderColor: t.c.brand, borderWidth: 2 }} testID="estimate">
              <T v="title" accessibilityRole="header">Your estimate</T>
              {quoting && !quote ? <ActivityIndicator color={t.c.brand} /> : null}
              {quote ? (
                <View style={{ gap: 6 }}>
                  {quote.lines.map((l) => (
                    <View key={l.serviceId} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <T v="small" style={{ flex: 1 }}>{l.name}</T><T v="small">{money(l.priceCents, { always: true })}</T>
                    </View>
                  ))}
                  {quote.pending.map((p) => (
                    <View key={p.serviceId} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <T v="small" style={{ flex: 1 }}>{p.name}</T><T v="hint">Quoted before ordering</T>
                    </View>
                  ))}
                  {quote.fees.map((f) => (
                    <View key={f.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <T v="hint" style={{ flex: 1 }}>{f.label}</T><T v="hint">{money(f.cents, { always: true })}</T>
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.c.line, paddingTop: 8 }}>
                    <T style={{ fontFamily: t.f.displayX, fontSize: 18 }}>Total</T>
                    <T style={{ fontFamily: t.f.displayX, fontSize: 18 }} testID="estimate-total">{money(quote.totalCents, { always: true })}</T>
                  </View>
                  {quote.savingsCents > 0 ? <T v="small" style={{ color: t.c.okText, fontFamily: t.f.bodyB }}>About {money(quote.savingsCents)} less than a typical shop</T> : null}
                  {quote.depositCents ? <T v="hint">Jobs over this size take a {money(quote.depositCents, { always: true })} deposit when you book.</T> : null}
                  <T v="hint">Your card is held for the estimate {quote.holdHoursBefore} hours before the visit and charged for the final total after the work.</T>
                </View>
              ) : null}
              {err ? <Notice tone="bad">{err}</Notice> : null}
              <Button title="Book this visit" onPress={() => router.push({ pathname: "/book", params: { vehicleId, serviceIds: picked.join(",") } })} testID="book-visit" />
            </Card>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
