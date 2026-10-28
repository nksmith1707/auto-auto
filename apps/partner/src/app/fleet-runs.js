// Fleet program: join (sign the Fleet Service Addendum), then open fleet visits near you and your own.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtWindow } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { card, label, muted } from "../components/Onboarding";
import { fonts, p } from "../theme";

const ST = { posted: ["Open", p.brandText], claimed: ["Claimed", p.ok], active: ["In progress", p.money], completed: ["Done · invoiced", p.muted] };

function RunCard({ r, onPress }) {
  const done = r.vehicles.filter((v) => ["done", "skipped"].includes(v.status)).length;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="fleet-run-card" style={({ pressed }) => [card, { gap: 4, padding: 14 }, pressed && { borderColor: p.brand }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: fonts.displayX, fontSize: 16, color: p.ink }} numberOfLines={1}>{r.fleet.name}</Text>
        <Text style={{ fontFamily: fonts.displayX, fontSize: 16, color: p.money }}>{money(r.pay.earningsCents)}</Text>
      </View>
      <Text style={muted}>{fmtWindow(r.windowStart, r.windowEnd)} · {r.vehicles.length} vehicle{r.vehicles.length === 1 ? "" : "s"} · {r.fleet.yard.city}{r.distanceMiles != null ? ` · ${r.distanceMiles} mi` : ""}</Text>
      <Text style={{ fontFamily: fonts.bodyB, fontSize: 12, color: ST[r.status][1] }}>{r.status === "active" ? `In progress · ${done}/${r.vehicles.length} vehicles` : ST[r.status][0]} · {r.services.map((s) => s.name).join(", ")}</Text>
    </Pressable>
  );
}

export default function FleetRuns() {
  const router = useRouter();
  const { call } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const load = useCallback(async () => { try { setD(await call("fleetRuns")); setErr(null); } catch (e) { setErr(e.message); } }, [call]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const open = (r) => router.push({ pathname: "/fleet-visit", params: { id: r.id } });
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={p.ink} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <TopBar onBack={back} title="Fleet visits" />
      {!d ? (err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brand} style={{ marginTop: 40 }} />) : (
        <View style={{ gap: 14 }}>
          {d.problem ? <Notice tone="bad">{d.problem}</Notice> : null}
          {d.needsAddendum ? (
            <View style={card}>
              <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.ink }}>Join the fleet program</Text>
              <Text style={[muted, { fontSize: 14, lineHeight: 20 }]}>Service several company vehicles in one trip at a business yard. Priced by book time at the fleet's labor rate, parts reimbursed at cost, and a $25 trip fee per visit that's yours. Auto-Auto bills the business; you're paid on your normal schedule.</Text>
              <Button title="Read and sign the Fleet Service Addendum" variant="money" onPress={() => router.push({ pathname: "/onboarding/document", params: { id: "fleet" } })} testID="fleet-join" />
            </View>
          ) : null}
          {d.mine.length ? <Text style={label}>Your fleet visits</Text> : null}
          {d.mine.map((r) => <RunCard key={r.id} r={r} onPress={() => open(r)} />)}
          {d.enrolled ? (
            <>
              <Text style={label}>Open fleet visits</Text>
              {d.open.map((r) => <RunCard key={r.id} r={r} onPress={() => open(r)} />)}
              {!d.open.length ? <Text style={muted}>No open fleet visits for your services right now. Pull down to refresh.</Text> : null}
            </>
          ) : null}
          {d.done.length ? <Text style={label}>Completed</Text> : null}
          {d.done.map((r) => <RunCard key={r.id} r={r} onPress={() => open(r)} />)}
        </View>
      )}
    </Screen>
  );
}
