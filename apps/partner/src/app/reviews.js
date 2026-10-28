// Ratings & reviews: average of the last 100 ratings, the spread, what customers mention, and recent reviews.
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

const label = { fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" };
const card = { backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, padding: 16, gap: 8 };
const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function Reviews() {
  const router = useRouter();
  const { call } = useAuth();
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useFocusEffect(useCallback(() => { call("partnerReviews").then(setR).catch((e) => setErr(e.message)); }, [call]));
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title="Ratings & reviews" />
      {!r ? (err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brandText} style={{ marginTop: 40 }} />) : (
        <View style={{ gap: 14 }}>
          <View style={[card, { alignItems: "center" }]}>
            <Text style={label}>Average from your last 100 ratings</Text>
            <Text style={{ fontFamily: fonts.displayX, fontSize: 40, color: p.money }} testID="rating-average">{r.average != null ? `★ ${r.average.toFixed(2)}` : "No ratings yet"}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>{r.count} rating{r.count === 1 ? "" : "s"} · {money(r.tipsLast30DaysCents, { always: true })} in tips the last 30 days</Text>
          </View>
          {r.count ? (
            <View style={card}>
              {r.distribution.map((d) => (
                <View key={d.stars} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ width: 28, fontFamily: fonts.bodyB, fontSize: 13, color: p.ink }}>{d.stars}★</Text>
                  <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: p.panel2, overflow: "hidden" }}><View style={{ width: `${d.pct}%`, height: "100%", backgroundColor: p.money }} /></View>
                  <Text style={{ width: 40, textAlign: "right", fontFamily: fonts.body, fontSize: 12, color: p.muted }}>{d.pct}%</Text>
                </View>
              ))}
            </View>
          ) : null}
          {r.mentions.length ? (
            <View style={{ gap: 8 }}>
              <Text style={label}>Customers mention</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {r.mentions.map((m) => <View key={m.tag} style={{ backgroundColor: p.brandSoft, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.brandText }}>{m.tag} · {m.count}</Text></View>)}
              </View>
            </View>
          ) : null}
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Keep your average at {r.reviewThreshold.toFixed(2)} or higher. Below that (with 10 or more ratings), your account gets a review.</Text>
          {r.reviews.map((x, i) => (
            <View key={i} style={card} testID="review">
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: fonts.bodyX, fontSize: 15, color: p.ink }}>{x.name}</Text>
                <Text style={{ color: p.money, fontSize: 15 }}>{"★".repeat(x.stars)}{"☆".repeat(5 - x.stars)}</Text>
              </View>
              {x.review ? <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink }}>"{x.review}"</Text> : null}
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>{day(x.at)} · {x.services.join(", ")}{x.tags.length ? ` · ${x.tags.join(", ")}` : ""}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
