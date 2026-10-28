// Damage claims about your jobs. Respond within 48 hours; only that job's pay is held until it's decided.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

const CLAIM_STATUS = { partner: ["Respond within 48 hours", p.money], review: ["Being reviewed", p.brandText], closed: ["Decided", p.ok] };

export default function Claims() {
  const router = useRouter();
  const { call } = useAuth();
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useFocusEffect(useCallback(() => { call("claims").then((r) => setList(r.claims)).catch((e) => setErr(e.message)); }, [call]));
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title="Claims" />
      {!list ? (err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brandText} style={{ marginTop: 40 }} />) : (
        <View style={{ gap: 12 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.muted }}>Customers can report damage within 30 days of a job. Your check-in photos are your best evidence. Respond to every claim before a decision.</Text>
          {!list.length ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 15, color: p.ink, textAlign: "center", marginTop: 20 }}>No claims. Keep taking those check-in photos.</Text> : null}
          {list.map((c) => {
            const st = c.status === "closed" ? [`Decided: ${c.decision.outcomeLabel}`, p.ok] : CLAIM_STATUS[c.status];
            return (
              <Pressable key={c.id} onPress={() => router.push({ pathname: "/claim", params: { id: c.id } })} accessibilityRole="button" testID="partner-claim"
                style={({ pressed }) => ({ backgroundColor: p.panel, borderWidth: 1, borderColor: pressed ? p.brand : p.line, borderRadius: 18, padding: 16, gap: 4 })}>
                <Text style={{ fontFamily: fonts.displayX, fontSize: 17, color: p.ink }}>{c.number} · {c.damageToLabel}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>{c.customer} · {c.job.services.join(", ")}</Text>
                <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, color: st[1] }}>{st[0]}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
