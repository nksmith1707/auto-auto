// One fleet vehicle's maintenance log: every visit with mileage, work, inspection, notes, and photos.
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Card, ConfirmRemove, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { VisitPhotos } from "../components/Photos";
import { Pill, VEHICLE_STATUS } from "../components/Fleet";

const INSPECTION = { brakes: "Brakes", tires: "Tires", fluids: "Fluids", battery: "Battery", wipers: "Wipers", lights: "Lights", belts_hoses: "Belts & hoses", filters: "Filters" };

export default function FleetLog() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/fleet"));
  useFocusEffect(useCallback(() => { call("fleetVehicleLog", String(id)).then(setD).catch((e) => setErr(e.message)); }, [call, id]));
  if (!d) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  const v = d.vehicle;
  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 14 }}>
        <View style={{ alignItems: "center", gap: 4 }}>
          <T v="h1" accessibilityRole="header">{v.unit}</T>
          <Text style={{ fontFamily: t.f.displayX, fontSize: 16, color: t.c.brand }}>{v.year} {v.make} {v.model} · {v.classLabel}</Text>
          <Pill tone={VEHICLE_STATUS[v.status][1]}>{VEHICLE_STATUS[v.status][0]}</Pill>
        </View>
        <Card style={{ gap: 4 }}>
          {[["Plate", v.plate || "—"], ["Mileage", v.mileage != null ? `${v.mileage.toLocaleString("en-US")} mi` : "—"], ["Next oil change", v.nextOilMiles ? `${v.nextOilMiles.toLocaleString("en-US")} mi` : "—"], ["DOT inspection due", v.dotDue || "—"]].map(([k, x]) => (
            <View key={k} style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="small">{k}</T><T v="small" style={{ fontFamily: t.f.bodyB }}>{x}</T></View>
          ))}
        </Card>
        <T v="title">Maintenance log</T>
        {!d.entries.length ? <T v="muted">No service on Auto-Auto yet.</T> : null}
        {d.entries.map((e) => {
          const flagged = Object.entries(e.inspection || {}).filter(([, x]) => x.status !== "good");
          return (
            <Card key={e.runVehicleId} style={{ gap: 6 }} testID="fleet-log-entry">
              <T style={{ fontFamily: t.f.bodyX }}>{day(e.doneAt)}{e.odometer != null ? ` · ${e.odometer.toLocaleString("en-US")} mi` : ""}</T>
              <T v="small">{e.services.join(", ")}</T>
              <T v="hint">{[e.partner, `Visit #${e.runNumber}`, e.po].filter(Boolean).join(" · ")}</T>
              <T v="small">Inspection: {flagged.length ? flagged.map(([k, x]) => `${INSPECTION[k]} ${x.status === "now" ? "needs attention" : "soon"}${x.note ? ` (${x.note})` : ""}`).join("; ") : "all 8 items good"}</T>
              {e.notes ? <T v="small">“{e.notes}”</T> : null}
              <VisitPhotos photos={e.photos} />
            </Card>
          );
        })}
        <ConfirmRemove label="Remove this vehicle" question={`Remove ${v.unit}? Its log stays in your records.`}
          onConfirm={async () => { await call("removeFleetVehicle", v.id); back(); }} />
      </View>
    </Screen>
  );
}
