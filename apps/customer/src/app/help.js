// Help & claims: report damage, a free warranty return for a repair, and your claims.
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Card, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

const STEP = { partner: "Waiting for your partner's response", review: "We're reviewing the evidence", closed: "Decided" };
const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Item({ title, sub, onPress, testID }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={title} testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[t.text.body, { fontFamily: t.f.bodyB }]}>{title}</Text>
        {sub ? <Text style={t.text.hint}>{sub}</Text> : null}
      </View>
      <Text style={[t.text.body, { color: t.c.brand }]}>›</Text>
    </Card>
  );
}

export default function Help() {
  const router = useRouter();
  const { call } = useAuth();
  const [claims, setClaims] = useState(null);
  const [repairs, setRepairs] = useState(null);
  const [showRepairs, setShowRepairs] = useState(false);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useFocusEffect(useCallback(() => {
    call("claims").then((r) => setClaims(r.claims)).catch((e) => setErr(e.message));
    call("jobs").then((r) => setRepairs(r.jobs.filter((j) => j.status === "completed" && j.care && j.care.warrantyActive && !j.warrantyReturn))).catch(() => setRepairs([]));
  }, [call]));

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 12 }}>
        <T v="h1" accessibilityRole="header">Help & claims</T>
        <Item title="Report damage" sub="To your vehicle or property during a visit" onPress={() => router.push("/claim-new")} testID="help-claim" />
        <Item title="Problem with a repair" sub="Free warranty return for 12 months or 12,000 miles" onPress={() => setShowRepairs((v) => !v)} testID="help-warranty" />
        {showRepairs ? (
          <View style={{ gap: 8, paddingLeft: 8 }}>
            {repairs && !repairs.length ? <T v="hint">No repairs under warranty right now.</T> : null}
            {(repairs || []).map((j) => (
              <Item key={j.id} title={j.final.lines.map((l) => l.name).join(", ")} sub={`${day(j.updatedAt)} · ${j.vehicle.year} ${j.vehicle.make} ${j.vehicle.model}${j.care.openWarrantyReturn ? " · return booked" : ""}`}
                onPress={() => router.push(j.care.openWarrantyReturn ? { pathname: "/job", params: { id: j.care.openWarrantyReturn } } : { pathname: "/warranty", params: { id: j.id } })} testID="help-repair" />
            ))}
          </View>
        ) : null}
        <Item title="Notifications" sub="Inbox, and how we reach you" onPress={() => router.push("/notifications")} />
        {claims && claims.length ? <T v="title" style={{ marginTop: 8 }}>Your claims</T> : null}
        {(claims || []).map((c) => (
          <Item key={c.id} title={`${c.number} · ${c.damageToLabel}`} sub={`${c.job.services.join(", ")} · ${c.decision ? `${c.decision.outcomeLabel}` : STEP[c.status]}`} onPress={() => router.push({ pathname: "/claim", params: { id: c.id } })} testID="my-claim" />
        ))}
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <T v="hint" style={{ textAlign: "center", marginTop: 8 }}>In an emergency, call 911 first.</T>
      </View>
    </Screen>
  );
}
