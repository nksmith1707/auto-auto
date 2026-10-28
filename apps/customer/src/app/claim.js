// One damage claim: what was reported, where it stands, and the decision.
import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Card, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { PhotoRow } from "../components/Photos";
import { CLAIM_STEPS, Timeline } from "../components/Care";

export default function Claim() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const load = useCallback(async () => { try { setC((await call("claim", String(id))).claim); setErr(null); } catch (e) { setErr(e.message); } }, [call, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!c) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  const d = c.decision;
  return (
    <Screen contentStyle={{ paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.c.muted} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <View style={{ gap: 2 }}>
          <T v="h1" accessibilityRole="header" testID="claim-number">{c.number}</T>
          <T v="muted">{c.damageToLabel} · {c.job.services.join(", ")}{c.partner ? ` · ${c.partner}` : ""}</T>
        </View>
        <Card style={{ gap: 6 }}>
          <T v="small">{c.description}</T>
          <T v="hint">You asked for: {c.wantsLabel}{c.estimateCents ? ` · estimate ${money(c.estimateCents, { always: true })}` : ""}</T>
          <PhotoRow title="Your photos" photos={c.photos} />
        </Card>
        <Card style={{ gap: 10 }}>
          <T v="title">Where it stands</T>
          <Timeline steps={CLAIM_STEPS} at={c.step} />
        </Card>
        {d ? (
          <Notice tone={d.outcome === "deny" ? "info" : "ok"}>{`${d.outcomeLabel}${d.amountCents ? `: ${money(d.amountCents, { always: true })}` : ""}. ${d.note}${d.outcome === "goodwill" ? " The credit comes off your next visit." : d.outcome === "pay" ? " Our claims team will contact you to arrange it." : ""}`}</Notice>
        ) : null}
        <Button title="See the check-in photos for this visit" variant="ghost" onPress={() => router.push({ pathname: "/job", params: { id: c.jobId } })} />
      </View>
    </Screen>
  );
}
