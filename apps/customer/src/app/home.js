// Signed-in home. For now it shows the account; booking, vehicles, and saved places come in later steps.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { formatPhone } from "../../../shared/api";
import { EngineLogo } from "../../../shared/Logo";
import { useAuth } from "../../../shared/session";
import { Button, LinkButton, Notice, Screen, T, useTheme } from "../../../shared/ui";

const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function Home() {
  const t = useTheme();
  const { user, offline, signOut, signOutEverywhere } = useAuth();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  if (!user) return null;

  async function run(which, fn) {
    setErr(null);
    setBusy(which);
    try { await fn(); } catch (e) { setErr(e.message); setBusy(null); }
  }

  const rows = [
    ["Name", `${user.firstName} ${user.lastName}`],
    ["Email", user.email],
    ["Mobile", user.phone ? formatPhone(user.phone) : "Not added"],
    ["Member since", fmtDate(user.createdAt)],
  ];

  return (
    <Screen contentStyle={{ paddingBottom: 24 }}>
      <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 10 }}>
        <T style={{ fontFamily: t.f.displayX, fontSize: 24, color: t.c.brand, letterSpacing: 0.5 }}>Auto-Auto</T>
        <T style={{ fontFamily: t.f.bodyB, fontSize: 11, letterSpacing: 1.76, textTransform: "uppercase", color: t.c.muted }}>Keep Moving Forward</T>
      </View>

      <View style={styles.hero} accessible accessibilityLabel={`Hi ${user.firstName}. You're signed in.`}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={t.p.brandDeep} />
              <Stop offset="1" stopColor={t.p.brand} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#hero)" />
        </Svg>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: t.f.displayX, fontSize: 26, color: "#fff" }}>Hi, {user.firstName}</Text>
          <Text style={{ fontFamily: t.f.body, fontSize: 14, color: "#DCE6FF", lineHeight: 20 }}>You're signed in. Adding vehicles and booking service are next.</Text>
        </View>
        <View><EngineLogo size={64} color="#BFD6FF" hole={t.p.brandDeep} /></View>
      </View>

      {offline ? <Notice tone="bad" style={{ marginTop: 14 }}>You're offline. Showing your saved account until the connection comes back.</Notice> : null}

      <View style={{ marginTop: 22, gap: 10 }}>
        <T v="title" accessibilityRole="header">Your account</T>
        <View style={[styles.card, { borderColor: t.c.line, backgroundColor: t.c.surface }]}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.c.line }]}>
              <Text style={t.text.label}>{k}</Text>
              <Text style={[t.text.body, { flexShrink: 1, textAlign: "right" }]} selectable>{v}</Text>
            </View>
          ))}
        </View>
      </View>

      <Notice style={{ marginTop: 16 }}>
        Partners only see your general area. Your exact address goes to the one partner you book, and only when they start driving to you.
      </Notice>

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
  hero: { borderRadius: 20, overflow: "hidden", padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 13 },
});
