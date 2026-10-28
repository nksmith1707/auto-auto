// Signed-in home: vehicles, saved places, and account. Booking comes in later steps.
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { GradientFill } from "../../../shared/Fill";
import { formatPhone, money } from "../../../shared/api";
import { STATUS_LABEL, fmtWindow } from "../../../shared/format";
import { EngineLogo } from "../../../shared/Logo";
import { useAuth } from "../../../shared/session";
import { Button, Card, LinkButton, Notice, Screen, T, useTheme } from "../../../shared/ui";

const FUEL = { gas: "Gas", diesel: "Diesel", hybrid: "Hybrid", electric: "Electric" };
const PARK = { driveway: "Driveway", street: "Street parking", lot: "Parking lot", garage: "Garage", other: "Other" };

// Diagonal brand fade, same as the prototype's vehicle card.
function Gradient({ from, to }) {
  return <GradientFill stops={[[0, from], [1, to]]} x1={0} y1={0} x2={1} y2={1} />;
}

function SectionHead({ title, action, onAction, testID }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <T v="title" accessibilityRole="header">{title}</T>
      {action ? <LinkButton title={action} onPress={onAction} textStyle={{ fontSize: 15 }} /> : null}
    </View>
  );
}

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { user, offline, call, signOut, signOutEverywhere } = useAuth();
  const [data, setData] = useState({ vehicles: null, places: null, jobs: [] });
  const [loadErr, setLoadErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const [v, p, j] = await Promise.all([call("vehicles"), call("places"), call("jobs")]);
      setData({ vehicles: v.vehicles, places: p.places, jobs: j.jobs });
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e.message);
    }
  }, [call]);

  // Reload whenever the screen comes back into view (after adding or editing).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!user) return null;

  async function run(which, fn) {
    setErr(null);
    setBusy(which);
    try { await fn(); } catch (e) { setErr(e.message); setBusy(null); }
  }

  const { vehicles, places, jobs } = data;
  const openJobs = jobs.filter((j) => !["completed", "cancelled", "expired"].includes(j.status));
  const pastJobs = jobs.filter((j) => ["completed", "cancelled", "expired"].includes(j.status)).slice(0, 5);
  const loading = vehicles === null && !loadErr;

  return (
    <Screen contentStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.c.muted} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 10 }}>
        <T style={{ fontFamily: t.f.displayX, fontSize: 24, color: t.c.brand, letterSpacing: 0.5 }}>Auto-Auto</T>
        <T style={{ fontFamily: t.f.bodyB, fontSize: 11, letterSpacing: 1.76, textTransform: "uppercase", color: t.c.muted }}>Keep Moving Forward</T>
      </View>

      <View style={styles.hero} accessible accessibilityLabel={`Hi ${user.firstName}.`}>
        <Gradient from={t.p.brandDeep} to={t.p.brand} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: t.f.displayX, fontSize: 26, color: "#fff" }}>Hi, {user.firstName}</Text>
          <Text style={{ fontFamily: t.f.body, fontSize: 14, color: "#DCE6FF", lineHeight: 20 }}>
            {openJobs.length ? `You have ${openJobs.length} visit${openJobs.length === 1 ? "" : "s"} coming up.` : vehicles && vehicles.length && places && places.length ? "Tap See prices on a vehicle to book service." : "Add your vehicle and where to meet you, then book service."}
          </Text>
        </View>
        <View><EngineLogo size={64} color="#BFD6FF" hole={t.p.brandDeep} /></View>
      </View>

      {offline ? <Notice tone="bad" style={{ marginTop: 14 }}>You're offline. Showing your saved account until the connection comes back.</Notice> : null}
      {loadErr ? <Notice tone="bad" style={{ marginTop: 14 }}>{loadErr} Pull down to try again.</Notice> : null}

      {/* Bookings */}
      {openJobs.length || pastJobs.length ? (
        <View style={{ marginTop: 22, gap: 10 }}>
          <SectionHead title="Your visits" />
          {[...openJobs, ...pastJobs].map((j) => (
            <Card key={j.id} onPress={() => router.push({ pathname: "/job", params: { id: j.id } })} accessibilityLabel={`${STATUS_LABEL[j.status]}, ${j.vehicle.model}`} style={{ gap: 4 }} testID="job-card">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <T style={{ fontFamily: t.f.displayX, fontSize: 16, flex: 1 }}>{STATUS_LABEL[j.status]}</T>
                <T v="small" style={{ fontFamily: t.f.bodyB }}>{money((j.final || j.quote).totalCents)}</T>
              </View>
              <T v="small">{[...j.quote.lines, ...j.quote.pending].map((l) => l.name).join(", ")}</T>
              <T v="hint">{j.vehicle.year} {j.vehicle.make} {j.vehicle.model} · {j.kind === "scheduled" ? fmtWindow(j.windowStart, j.windowEnd) : j.kind === "roadside" ? "Roadside" : "As soon as possible"}</T>
            </Card>
          ))}
        </View>
      ) : null}

      {/* Vehicles */}
      <View style={{ marginTop: 22, gap: 10 }}>
        <SectionHead title="Your vehicles" action={vehicles && vehicles.length ? "+ Add" : null} onAction={() => router.push("/vehicle")} />
        {loading ? <T v="muted">Loading…</T> : null}
        {vehicles && !vehicles.length ? (
          <Card style={{ gap: 10, alignItems: "center", paddingVertical: 20 }}>
            <T v="muted" style={{ textAlign: "center" }}>Add your vehicle so partners bring the right parts and oil.</T>
            <Button title="Add a vehicle" onPress={() => router.push("/vehicle")} style={{ alignSelf: "stretch" }} testID="add-vehicle" />
          </Card>
        ) : null}
        {(vehicles || []).map((v) => (
          <Card key={v.id} onPress={() => router.push({ pathname: "/vehicle", params: { id: v.id } })} accessibilityLabel={`Edit ${v.year} ${v.make} ${v.model}`}
            style={{ overflow: "hidden", borderWidth: 0, padding: 16, gap: 8, backgroundColor: t.p.brand }} testID="vehicle-card">
            <Gradient from={t.p.brandDeep} to={t.p.brand} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: t.f.displayX, fontSize: 20, color: "#fff" }}>{v.year} {v.make} {v.model}</Text>
                {v.trim || v.color ? <Text style={{ fontFamily: t.f.body, fontSize: 14, color: "#DCE6FF" }}>{[v.trim, v.color].filter(Boolean).join(" · ")}</Text> : null}
              </View>
              <Text style={{ fontFamily: t.f.bodyB, fontSize: 13, color: "#DCE6FF" }}>Edit</Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[FUEL[v.fuel], v.mileage != null ? `${v.mileage.toLocaleString("en-US")} mi` : null, v.plate ? `${v.plate}${v.plateState ? ` · ${v.plateState}` : ""}` : null, v.vin ? "VIN on file" : null]
                .filter(Boolean).map((x) => (
                  <View key={x} style={styles.pill}><Text style={{ fontFamily: t.f.bodyB, fontSize: 12, color: "#fff" }}>{x}</Text></View>
                ))}
            </View>
            <Pressable onPress={() => router.push({ pathname: "/prices", params: { vehicleId: v.id } })} accessibilityRole="button"
              accessibilityLabel={`See prices for the ${v.year} ${v.make} ${v.model}`} testID="see-prices"
              style={({ pressed }) => [styles.pricesBtn, pressed && { opacity: 0.85 }]}>
              <Text style={{ fontFamily: t.f.displayX, fontSize: 15, color: "#0A2A7A", letterSpacing: 0.3 }}>See prices for this vehicle ›</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/history", params: { vehicleId: v.id } })} accessibilityRole="button"
              accessibilityLabel={`Service history for the ${v.year} ${v.make} ${v.model}`} testID="open-history" style={{ alignSelf: "center", paddingVertical: 4 }}>
              <Text style={{ fontFamily: t.f.bodyX, fontSize: 14, color: "#fff" }}>Service history ›</Text>
            </Pressable>
          </Card>
        ))}
      </View>

      {/* Places */}
      <View style={{ marginTop: 22, gap: 10 }}>
        <SectionHead title="Where we meet you" action={places && places.length ? "+ Add" : null} onAction={() => router.push("/place")} />
        {places && !places.length ? (
          <Card style={{ gap: 10, alignItems: "center", paddingVertical: 20 }}>
            <T v="muted" style={{ textAlign: "center" }}>Save your home or work address. It stays private until your partner starts driving to you.</T>
            <Button title="Add a place" onPress={() => router.push("/place")} style={{ alignSelf: "stretch" }} testID="add-place" />
          </Card>
        ) : null}
        {(places || []).map((p) => (
          <Card key={p.id} onPress={() => router.push({ pathname: "/place", params: { id: p.id } })} accessibilityLabel={`Edit ${p.label}`} style={{ gap: 4 }} testID="place-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T style={{ fontFamily: t.f.displayX, fontSize: 17, flex: 1 }}>{p.label}</T>
              {p.isDefault ? <View style={[styles.tag, { backgroundColor: t.c.brandSoft }]}><Text style={{ fontFamily: t.f.bodyB, fontSize: 11, color: t.c.brand }}>Default</Text></View> : null}
            </View>
            <T v="small">{p.street}{p.unit ? `, ${p.unit}` : ""}</T>
            <T v="hint">{p.city}, {p.state} {p.zip}{p.parking ? ` · ${PARK[p.parking]}` : ""}</T>
          </Card>
        ))}
      </View>

      {/* Account */}
      <View style={{ marginTop: 22, gap: 10 }}>
        <SectionHead title="Your account" action="Edit" onAction={() => router.push("/profile")} />
        <View style={[styles.card, { borderColor: t.c.line, backgroundColor: t.c.surface }]}>
          {[["Name", `${user.firstName} ${user.lastName}`], ["Email", user.email], ["Mobile", user.phone ? formatPhone(user.phone) : "Not added"]].map(([k, v], i) => (
            <View key={k} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.c.line }]}>
              <Text style={t.text.label}>{k}</Text>
              <Text style={[t.text.body, { flexShrink: 1, textAlign: "right" }]} selectable>{v}</Text>
            </View>
          ))}
        </View>
        <Card onPress={() => router.push("/fleet")} accessibilityLabel="Business account" testID="open-fleet" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.text.body, { fontFamily: t.f.bodyB }]}>Business account</Text>
            <Text style={t.text.hint}>Fleet vehicles, one visit for many, one invoice</Text>
          </View>
          <Text style={[t.text.body, { color: t.c.brand }]}>›</Text>
        </Card>
        <Card onPress={() => router.push("/cards")} accessibilityLabel="Payment cards" testID="open-cards" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[t.text.body, { fontFamily: t.f.bodyB }]}>Payment cards</Text>
          <Text style={[t.text.body, { color: t.c.brand }]}>›</Text>
        </Card>
      </View>

      <View style={{ marginTop: "auto", paddingTop: 28, gap: 10 }}>
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <Button title="Log out" variant="ghost" onPress={() => run("one", signOut)} loading={busy === "one"} testID="sign-out" />
        {confirmAll ? (
          <View style={{ gap: 10 }}>
            <T v="small" style={{ textAlign: "center" }}>Log out on every phone and computer that's signed in to your account?</T>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button style={{ flex: 1 }} title="Cancel" variant="ghost" onPress={() => setConfirmAll(false)} />
              <Button style={{ flex: 1 }} title="Log out all" variant="danger" onPress={() => run("all", signOutEverywhere)} loading={busy === "all"} />
            </View>
          </View>
        ) : (
          <LinkButton title="Log out on all devices" style={{ alignSelf: "center" }} textStyle={{ color: t.c.muted, fontSize: 14 }} onPress={() => setConfirmAll(true)} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 20, overflow: "hidden", padding: 16, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1550E6" },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 13 },
  pill: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  tag: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  pricesBtn: { marginTop: 4, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 11, alignItems: "center" },
});
