// Payment cards. Cards are typed on Stripe's secure page; the app only ever sees the brand and last 4 digits.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { openStripePage } from "../../../shared/stripePage";
import { Button, Card, ConfirmRemove, LinkButton, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

export default function Cards() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { call } = useAuth();
  const [cards, setCards] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  // Coming back from Stripe's page (on the web the app reloads here with ?done=1): pull the new card in.
  const sync = useCallback(async () => {
    const r = await call("syncCards");
    setCards(r.cards);
    return r.cards;
  }, [call]);

  useEffect(() => {
    call("paymentsConfig").then(setCfg).catch(() => setCfg({ enabled: false }));
    (params.done ? sync() : call("cards").then((r) => setCards(r.cards)))
      .then(() => { if (params.done === "1") setNote("Card saved."); })
      .catch((e) => { setErr(e.message); setCards((c) => c || []); });
  }, [call, sync, params.done]);

  async function add() {
    setErr(null);
    setNote(null);
    setBusy("add");
    try {
      const before = (cards || []).length;
      await openStripePage("/cards", (returnUrl) => call("cardSetup", returnUrl));
      const now = await sync();
      if (now.length > before) setNote("Card saved.");
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  async function makeDefault(id) {
    setErr(null);
    setBusy(id);
    try { setCards((await call("setDefaultCard", id)).cards); } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>Payment cards</T>
        {cfg && !cfg.enabled ? <Notice>Payments aren't turned on yet. You can book without a card for now.</Notice> : null}
        {!cards ? <ActivityIndicator color={t.c.brand} style={{ marginTop: 24 }} /> : null}
        {cards && !cards.length && cfg && cfg.enabled ? (
          <Card style={{ gap: 6, alignItems: "center", paddingVertical: 20 }}>
            <T v="muted" style={{ textAlign: "center" }}>No cards yet. Add one to book visits.</T>
          </Card>
        ) : null}
        {(cards || []).map((c) => (
          <Card key={c.id} style={{ gap: 8 }} testID="card-row">
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: t.f.displayX, fontSize: 17, color: t.c.ink, textTransform: "capitalize" }}>{c.brand} •••• {c.last4}</Text>
              {c.isDefault ? (
                <View style={{ backgroundColor: t.c.brand, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ color: "#fff", fontFamily: t.f.bodyB, fontSize: 12 }}>Default</Text>
                </View>
              ) : null}
            </View>
            <T v="hint">Expires {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}</T>
            {!c.isDefault ? <LinkButton title={busy === c.id ? "Saving…" : "Use for payments"} onPress={() => makeDefault(c.id)} style={{ alignSelf: "flex-start" }} /> : null}
            <ConfirmRemove label="Remove card" question={`Remove ${c.brand} •••• ${c.last4}?`} testID="remove-card"
              onConfirm={async () => setCards((await call("removeCard", c.id)).cards)} />
          </Card>
        ))}
        {note ? <Notice tone="ok">{note}</Notice> : null}
        {err ? <Notice tone="bad">{err}</Notice> : null}
        {cfg && cfg.enabled ? <Button title="Add a card" onPress={add} loading={busy === "add"} testID="add-card" /> : null}
        {cfg && cfg.enabled && cfg.testMode ? (
          <Notice>Test mode: no real money moves. Use card 4242 4242 4242 4242, any future date, any 3 digits, and any ZIP.</Notice>
        ) : null}
        <T v="hint" style={{ textAlign: "center" }}>Card numbers are saved by Stripe, our payment processor. Auto-Auto never sees or stores them.</T>
      </View>
    </Screen>
  );
}
