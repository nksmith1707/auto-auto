// Services you offer, grouped by category, with on/off switches like the prototype's "Services & pay" page.
// Pay per service comes with the pricing engine (step 5).
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Notice, Screen, T } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

function Toggle({ on }) {
  return (
    <View style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: on ? p.ok : p.panel2, alignItems: on ? "flex-end" : "flex-start" }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" }} />
    </View>
  );
}

export default function Services() {
  const router = useRouter();
  const { call, refresh, user } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  const [pay, setPay] = useState({});
  const [waiting, setWaiting] = useState([]);
  const [savedNote, setSavedNote] = useState(false);
  const approved = user && user.partner && user.partner.status !== "applicant";
  useEffect(() => {
    call("partnerServices").then(({ services, catalog: c, waitingForProof }) => {
      setCatalog(c);
      setWaiting(waitingForProof || []);
      setChosen(new Set(services.map((s) => s.id)));
    }).catch((e) => setErr(e.message));
    // What each job pays on a typical car, from the pricing engine. Not essential, so errors are ignored.
    call("priceMenu", { make: "Honda", model: "Civic", year: 2015 })
      .then((m) => setPay(Object.fromEntries(m.items.map((i) => [i.serviceId, i]))))
      .catch(() => {});
  }, [call]);

  const groups = useMemo(() => (catalog ? catalog.categories.map((c) => ({ ...c, items: catalog.services.filter((s) => s.category === c.id) })) : []), [catalog]);
  const toggle = (id) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const proofCount = catalog ? catalog.services.filter((s) => s.needsProof && chosen.has(s.id)).length : 0;

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const r = await call("savePartnerServices", [...chosen]);
      await refresh().catch(() => {});
      // Approved partners who switched on a service that needs proof stay here to see what to upload.
      if (approved && r.waitingForProof && r.waitingForProof.length) { setWaiting(r.waitingForProof); setSavedNote(true); setBusy(false); return; }
      back();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title="Services" />
      {!catalog && !err ? <ActivityIndicator color={p.brandText} style={{ marginTop: 40 }} /> : null}
      {catalog ? (
        <View style={{ gap: 18 }}>
          <View style={{ gap: 8 }}>
            <T v="h1" accessibilityRole="header">What do you offer?</T>
            <T v="muted">Turn on the work you're set up to do. You'll only get requests for these. Auto-Auto sets fair, guaranteed prices from standard book times, so you never have to quote.</T>
            <T v="hint">Pay shown is for an at-home job on a 2015 Honda Civic: labor after the platform fee, plus the mobile fee, at least the visit minimum. Trucks and bigger engines take longer and pay more. Parts are reimbursed at cost on top.</T>
          </View>
          {groups.map((g) => (
            <View key={g.id} style={{ backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6 }}>
              <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase", paddingTop: 10, paddingBottom: 4 }}>{g.name}</Text>
              {g.items.map((s, i) => {
                const on = chosen.has(s.id);
                return (
                  <Pressable key={s.id} onPress={() => toggle(s.id)} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`Offer ${s.name}`} testID={`svc-${s.id}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontFamily: fonts.bodyB, fontSize: 15, color: p.ink }}>{s.name}</Text>
                      {pay[s.id] && pay[s.id].partnerEarnsCents != null ? (
                        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>
                          You earn <Text style={{ fontFamily: fonts.bodyX, color: p.money }}>{money(pay[s.id].partnerEarnsCents)}</Text> · customer pays {money(pay[s.id].priceCents)}
                          {pay[s.id].partsCostCents ? ` · parts ${money(pay[s.id].partsCostCents)} reimbursed` : ""}
                        </Text>
                      ) : pay[s.id] && pay[s.id].quoted ? (
                        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>You quote it from the glass cost</Text>
                      ) : pay[s.id] && pay[s.id].fleetOnly ? (
                        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>Priced per fleet vehicle</Text>
                      ) : null}
                      {s.needsProof ? (
                        approved && on && waiting.some((w) => w.serviceId === s.id)
                          ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 11, color: p.bad }} testID={`svc-waiting-${s.id}`}>Waiting for your proof to be approved</Text>
                          : approved && on ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 11, color: p.ok }}>Proof approved</Text>
                            : <Text style={{ fontFamily: fonts.bodyB, fontSize: 11, color: p.money }}>Needs proof on file</Text>
                      ) : null}
                    </View>
                    <Toggle on={on} />
                  </Pressable>
                );
              })}
            </View>
          ))}
          {approved && waiting.length ? (
            <View style={{ backgroundColor: p.moneySoft, borderRadius: 14, padding: 12, gap: 8 }} testID="proof-waiting">
              <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.ink }}>{savedNote ? "Saved. " : ""}You won't get these jobs until we approve your proof:</Text>
              {waiting.map((w) => <Text key={w.serviceId} style={{ fontFamily: fonts.body, fontSize: 13, color: p.ink }}>• {w.name}: {w.needs.join(" and ")}</Text>)}
              <Button title="Upload proof" variant="money" onPress={() => router.push("/onboarding/skills")} testID="upload-proof" />
              {savedNote ? <Button title="Done" variant="ghost" onPress={back} /> : null}
            </View>
          ) : !approved && proofCount ? (
            <Notice style={{ backgroundColor: p.moneySoft, borderColor: "transparent" }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: p.ink }}>
                {proofCount === 1 ? "One service you picked needs" : `${proofCount} services you picked need`} proof on file (certification, insurance, or water containment for washing). You'll upload it later in your application. Until then you won't get those jobs.
              </Text>
            </Notice>
          ) : null}
          {err ? <Notice tone="bad">{err}</Notice> : null}
          <Button title={`Save ${chosen.size} service${chosen.size === 1 ? "" : "s"}`} onPress={save} loading={busy} disabled={!chosen.size} big testID="svc-save" />
          {!chosen.size ? <T v="hint" style={{ textAlign: "center" }}>Turn on at least one service.</T> : null}
        </View>
      ) : null}
      {err && !catalog ? <Notice tone="bad">{err}</Notice> : null}
    </Screen>
  );
}
