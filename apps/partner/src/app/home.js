// Signed-in partner home. Until the partner is approved, this is their application status.
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatPhone } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, LinkButton, Notice } from "../../../shared/ui";
import { fonts, p } from "../theme";

const STATUS = {
  applicant: { label: "Application started", tone: "money", text: "Your account is set up. Next you'll add your business and tax details, ID and driving record, background check, services, payout account, and sign the partner agreements." },
  in_review: { label: "In review", tone: "brand", text: "We're reviewing your application. We'll let you know as soon as there's a decision." },
  active: { label: "Approved", tone: "ok", text: "You're approved. Jobs near you will show up here." },
  paused: { label: "Paused", tone: "bad", text: "Your account is paused, so you won't get new jobs. Contact partner support to get back on the road." },
  deactivated: { label: "Deactivated", tone: "bad", text: "This account can't take jobs. Contact partner support if you think this is a mistake." },
};
const CHIP = {
  money: { bg: p.moneySoft, fg: p.money }, brand: { bg: p.brandSoft, fg: p.brandText }, ok: { bg: p.okSoft, fg: p.ok }, bad: { bg: p.badSoft, fg: p.bad },
};
const STEPS = ["Account", "Business & tax (W-9)", "Identity & driving", "Background check", "Services & certifications", "Payouts", "Agreements", "Review & submit"];

export default function Home() {
  const { user, offline, refresh, signOut, signOutEverywhere } = useAuth();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  if (!user) return null;

  const st = STATUS[(user.partner && user.partner.status) || "applicant"] || STATUS.applicant;
  const chip = CHIP[st.tone];
  const initials = `${user.firstName[0] || ""}${user.lastName[0] || ""}`.toUpperCase();
  const applying = !user.partner || user.partner.status === "applicant";

  async function run(which, fn) {
    setErr(null);
    setBusy(which);
    try { await fn(); } catch (e) { setErr(e.message); setBusy(null); }
  }
  async function pull() {
    setRefreshing(true);
    try { await refresh(); setErr(null); } catch (e) { setErr(e.message); } finally { setRefreshing(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={p.muted} />}>
        <View style={{ flex: 1, width: "100%", maxWidth: 460, alignSelf: "center" }}>
          <View style={styles.top}>
            <View style={styles.avatar}><Text style={{ fontFamily: fonts.displayX, fontSize: 16, color: "#fff" }}>{initials}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.muted }}>Welcome</Text>
              <Text style={{ fontFamily: fonts.displayX, fontSize: 20, color: p.ink }} numberOfLines={1}>Hi, {user.firstName}</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: chip.bg }]}><Text style={[styles.chipText, { color: chip.fg }]}>{st.label}</Text></View>
          </View>

          {offline ? <Notice tone="bad" style={{ marginBottom: 14 }}>You're offline. Showing your saved account until the connection comes back.</Notice> : null}

          <View style={styles.card}>
            <Text style={styles.label}>Your application</Text>
            <Text style={{ fontFamily: fonts.displayX, fontSize: 22, color: p.ink }} accessibilityRole="header">{st.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: p.muted }}>{st.text}</Text>
            {applying ? (
              <View style={{ gap: 10, marginTop: 6 }}>
                {STEPS.map((s, i) => (
                  <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={[styles.dot, i === 0 ? { backgroundColor: p.ok, borderColor: p.ok } : null]}>
                      <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: i === 0 ? "#03200F" : p.muted }}>{i === 0 ? "✓" : i + 1}</Text>
                    </View>
                    <Text style={{ flex: 1, fontFamily: i === 0 ? fonts.bodyB : fonts.body, fontSize: 14, color: i === 0 ? p.ink : p.muted }}>{s}</Text>
                    {i === 0 ? <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: p.ok }}>DONE</Text> : null}
                  </View>
                ))}
                <Notice style={{ marginTop: 4, backgroundColor: p.panel2 }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: p.ink }}>The rest of the application opens in an upcoming update. You'll finish it here in the app; nothing else is needed from you yet.</Text>
                </Notice>
              </View>
            ) : null}
          </View>

          <View style={[styles.card, { marginTop: 14, gap: 0, paddingVertical: 4 }]}>
            {[["Name", `${user.firstName} ${user.lastName}`], ["Email", user.email], ["Mobile", user.phone ? formatPhone(user.phone) : "Not added"]].map(([k, v], i) => (
              <View key={k} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: p.line }]}>
                <Text style={styles.label}>{k}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 15, color: p.ink, flexShrink: 1, textAlign: "right" }} selectable>{v}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: "auto", paddingTop: 28, gap: 10 }}>
            {err ? <Notice tone="bad">{err}</Notice> : null}
            <Button title="Log out" variant="ghost" onPress={() => run("one", signOut)} loading={busy === "one"} testID="sign-out" />
            {confirmAll ? (
              <View style={{ gap: 10 }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink, textAlign: "center" }}>Log out on every phone and computer that's signed in to your account?</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button style={{ flex: 1 }} title="Cancel" variant="ghost" onPress={() => setConfirmAll(false)} />
                  <Button style={{ flex: 1 }} title="Log out all" variant="danger" onPress={() => run("all", signOutEverywhere)} loading={busy === "all"} />
                </View>
              </View>
            ) : (
              <LinkButton title="Log out on all devices" style={{ alignSelf: "center" }} textStyle={{ color: p.muted, fontSize: 14 }} onPress={() => setConfirmAll(true)} />
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: p.brand, alignItems: "center", justifyContent: "center" },
  chip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fonts.bodyX, fontSize: 11 },
  card: { backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, padding: 16, gap: 8 },
  label: { fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: p.line, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 13 },
});
