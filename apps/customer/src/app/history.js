// Service history for one vehicle: every finished visit with mileage, work done, inspection, notes, and photos.
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Card, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { VisitPhotos } from "../components/Photos";

const INSPECTION = { brakes: "Brakes", tires: "Tires", fluids: "Fluids", battery: "Battery", wipers: "Wipers", lights: "Lights", belts_hoses: "Belts & hoses", filters: "Filters" };
const RATING = { good: "Good", soon: "Soon", now: "Needs attention" };

export default function History() {
  const t = useTheme();
  const router = useRouter();
  const { vehicleId } = useLocalSearchParams();
  const { call } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useFocusEffect(useCallback(() => { call("vehicleHistory", String(vehicleId)).then(setData).catch((e) => setErr(e.message)); }, [call, vehicleId]));

  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      {!data ? (err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />) : (
        <View style={{ gap: 14 }}>
          <View style={{ alignItems: "center", gap: 2 }}>
            <T v="h1" accessibilityRole="header">Service history</T>
            <Text style={{ fontFamily: t.f.displayX, fontSize: 17, color: t.c.brand }}>{data.vehicle.year} {data.vehicle.make} {data.vehicle.model}</Text>
          </View>
          {!data.visits.length ? <Card><T v="muted" style={{ textAlign: "center" }}>No finished visits yet. After your first one, the work, inspection, and photos are saved here.</T></Card> : null}
          {data.visits.map((v) => {
            const flagged = Object.entries(v.inspection || {}).filter(([, x]) => x.status !== "good");
            return (
              <Card key={v.jobId} style={{ gap: 8 }} testID="history-visit">
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <T v="title" style={{ flex: 1 }}>{day(v.completedAt)}</T>
                  {v.totalCents != null ? <T style={{ fontFamily: t.f.displayX }}>{money(v.totalCents, { always: true })}</T> : null}
                </View>
                <T v="small">{v.services.join(", ")}</T>
                <T v="hint">{[v.odometer != null ? `${v.odometer.toLocaleString("en-US")} mi` : null, v.partner ? `by ${v.partner}` : null].filter(Boolean).join(" · ")}</T>
                {v.notes ? <T v="small">Partner notes: {v.notes}</T> : null}
                <T v="small">Inspection: {flagged.length ? flagged.map(([k, x]) => `${INSPECTION[k]} ${RATING[x.status].toLowerCase()}${x.note ? ` (${x.note})` : ""}`).join("; ") : "all 8 items good"}</T>
                {v.warrantyUntil ? <T v="hint">Warranty until {day(v.warrantyUntil)}{v.warrantyMilesUntil ? ` or ${v.warrantyMilesUntil.toLocaleString("en-US")} mi` : ""}</T> : null}
                <VisitPhotos photos={v.photos} />
                <Text onPress={() => router.push({ pathname: "/job", params: { id: v.jobId } })} style={{ fontFamily: t.f.bodyX, fontSize: 14, color: t.c.brand }}>View visit ›</Text>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
