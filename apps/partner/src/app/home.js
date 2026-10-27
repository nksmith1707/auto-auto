// Signed-in partner home. Until the partner is approved, this is their application status.
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatPhone, money } from "../../../shared/api";
import { fmtLeft, fmtWindow } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, LinkButton, Notice } from "../../../shared/ui";
import { fonts, p } from "../theme";

const STATUS = {
  applicant: { label: "Application started", tone: "money", text: "Set your service area and the services you offer now. Business and tax details, ID, background check, proof of certifications, payouts, and agreements open in upcoming updates." },
  in_review: { label: "In review", tone: "brand", text: "We're reviewing your application. We'll let you know as soon as there's a decision." },
  active: { label: "Approved", tone: "ok", text: "You're approved. Jobs near you will show up here." },
  paused: { label: "Paused", tone: "bad", text: "Your account is paused, so you won't get new jobs. Contact partner support to get back on the road." },
  deactivated: { label: "Deactivated", tone: "bad", text: "This account can't take jobs. Contact partner support if you think this is a mistake." },
};
const CHIP = {
  money: { bg: p.moneySoft, fg: p.money }, brand: { bg: p.brandSoft, fg: p.brandText }, ok: { bg: p.okSoft, fg: p.ok }, bad: { bg: p.badSoft, fg: p.bad },
};
const LATER = ["Business & tax (W-9)", "Identity & driving", "Background check", "Certifications & insurance", "Payouts", "Agreements", "Review & submit"];

function Step({ n, title, sub, done, onPress, testID }) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: onPress ? 6 : 0 }}>
      <View style={[styles.dot, done ? { backgroundColor: p.ok, borderColor: p.ok } : onPress ? { borderColor: p.money } : null]}>
        <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: done ? "#03200F" : onPress ? p.money : p.muted }}>{done ? "✓" : n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: done || onPress ? fonts.bodyB : fonts.body, fontSize: 14, color: done || onPress ? p.ink : p.muted }}>{title}</Text>
        {sub ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>{sub}</Text> : null}
      </View>
      {done ? <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: p.ok }}>{onPress ? "EDIT" : "DONE"}</Text> : onPress ? <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: p.money }}>START ›</Text> : null}
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}${done ? ", done" : ""}`} testID={testID}>{body}</Pressable>;
}

const KIND = { scheduled: "", asap: "ASAP", roadside: "ROADSIDE" };
function JobList({ title, jobs, empty, onOpen, board }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{title}</Text>
      {!jobs.length && empty ? <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.muted }}>{empty}</Text> : null}
      {jobs.map((j) => (
        <Pressable key={j.id} onPress={() => onOpen(j.id)} accessibilityRole="button" testID={board ? "board-job" : "my-job"}
          style={({ pressed }) => [styles.card, { gap: 4, padding: 14 }, pressed && { borderColor: p.brand }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.displayX, fontSize: 16, color: p.ink }} numberOfLines={1}>{j.services.map((x) => x.name).concat(j.pendingQuotes.map((x) => x.name)).join(", ")}</Text>
            <Text style={{ fontFamily: fonts.displayX, fontSize: 16, color: p.money }}>{money((j.final ? j.final.partnerPay : j.pay).earningsCents)}</Text>
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>
            {KIND[j.kind] ? `${KIND[j.kind]} · ` : ""}{j.kind === "scheduled" ? fmtWindow(j.windowStart, j.windowEnd) : `open ${fmtLeft(j.requestExpiresAt - Date.now())} more`} · {j.area}{j.distanceMiles != null ? ` · ${j.distanceMiles} mi` : ""}
          </Text>
          <Text style={{ fontFamily: fonts.bodyB, fontSize: 12, color: board ? p.brandText : p.ok }}>{board ? `${j.vehicle.year} ${j.vehicle.make} ${j.vehicle.model}` : STATUS_TXT[j.status]}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const STATUS_TXT = { requested: "Open", awaiting_approval: "Waiting for customer", confirmed: "Confirmed", en_route: "On the way", arrived: "Arrived", in_progress: "Working", completed: "Completed", cancelled: "Cancelled", expired: "Closed" };

export default function Home() {
  const router = useRouter();
  const { user, offline, refresh, call, signOut, signOutEverywhere } = useAuth();
  const [jobs, setJobs] = useState({ mine: null, board: null, blocked: null });
  const active = !!(user && user.partner && user.partner.status === "active");
  const loadJobs = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([call("jobs"), call("jobBoard")]);
      setJobs({ mine: m.jobs, board: b.jobs, blocked: b.blocked });
    } catch { /* shown as empty; pull to refresh */ }
  }, [call]);
  // Instant job offers: 30 seconds each, so check every 5 seconds while home is open.
  const [offers, setOffers] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [offerBusy, setOfferBusy] = useState(null);
  const loadOffers = useCallback(async () => { try { setOffers((await call("offers")).offers); } catch {} }, [call]);
  useFocusEffect(useCallback(() => {
    if (!active) return undefined;
    loadOffers();
    const a = setInterval(loadOffers, 5000);
    const b = setInterval(() => setNowTick(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [active, loadOffers]));
  async function answer(o, accept) {
    setOfferBusy(o.offerId);
    try {
      if (accept) { await call("jobAction", o.job.id, "accept"); router.push({ pathname: "/job", params: { id: o.job.id } }); }
      else await call("jobAction", o.job.id, "decline-offer");
    } catch (e) { setErr(e.message); }
    finally { setOfferBusy(null); loadOffers(); loadJobs(); }
  }
  // Pick up changes made on other screens.
  useFocusEffect(useCallback(() => { refresh().catch(() => {}); loadJobs(); }, [refresh, loadJobs]));
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
    try { await refresh(); await loadJobs(); setErr(null); } catch (e) { setErr(e.message); } finally { setRefreshing(false); }
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

          {active ? offers.filter((o) => o.expiresAt > nowTick).map((o) => (
            <View key={o.offerId} style={[styles.card, { borderColor: p.money, borderWidth: 2, marginBottom: 14, gap: 8 }]} testID="offer-card">
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[styles.label, { color: p.money }]}>{o.job.kind === "roadside" ? "Roadside request" : "New job offer"}</Text>
                <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.money }}>{Math.max(0, Math.ceil((o.expiresAt - nowTick) / 1000))}s</Text>
              </View>
              <Text style={{ fontFamily: fonts.displayX, fontSize: 20, color: p.ink }}>{o.job.services.map((x) => x.name).join(", ")}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.muted }}>
                {o.job.vehicle.year} {o.job.vehicle.make} {o.job.vehicle.model} · {o.job.area}{o.distanceMiles != null ? ` · ${o.distanceMiles} mi (~${Math.max(5, Math.round(o.distanceMiles * 2.2))} min)` : ""}
              </Text>
              <Text style={{ fontFamily: fonts.bodyX, fontSize: 15, color: p.ink }}>You earn {money(o.job.pay.earningsCents)}{o.job.pay.partsReimbursedCents ? ` + ${money(o.job.pay.partsReimbursedCents)} parts at cost` : ""}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button style={{ flex: 1 }} title="Pass" variant="ghost" onPress={() => answer(o, false)} loading={offerBusy === o.offerId} testID="offer-decline" />
                <Button style={{ flex: 2 }} title="Accept" variant="money" onPress={() => answer(o, true)} loading={offerBusy === o.offerId} testID="offer-accept" />
              </View>
            </View>
          )) : null}

          {active ? (
            <View style={{ gap: 14, marginBottom: 14 }}>
              <JobList title="Your jobs" empty="No jobs yet. Accept one below." jobs={(jobs.mine || []).filter((j) => !["completed", "cancelled", "expired"].includes(j.status))} onOpen={(id) => router.push({ pathname: "/job", params: { id } })} />
              <JobList title="Open jobs" empty={jobs.board ? "No open jobs for your services right now. Pull down to refresh." : "Loading…"} jobs={jobs.board || []} onOpen={(id) => router.push({ pathname: "/job", params: { id } })} board />
              {(jobs.mine || []).some((j) => j.status === "completed") ? (
                <JobList title="Done" jobs={(jobs.mine || []).filter((j) => ["completed", "cancelled"].includes(j.status)).slice(0, 5)} onOpen={(id) => router.push({ pathname: "/job", params: { id } })} />
              ) : null}
              <View style={[styles.card, { gap: 4 }]}>
                <Step n={1} title="Service area" sub={user.partner.serviceAreaSet ? "Set" : "Where you'll travel for jobs"} done={!!user.partner.serviceAreaSet} onPress={() => router.push("/service-area")} />
                <Step n={2} title="Services you offer" sub={`${user.partner.servicesCount} turned on`} done={!!user.partner.servicesCount} onPress={() => router.push("/services")} />
              </View>
            </View>
          ) : null}

          {!active ? (
          <View style={styles.card}>
            <Text style={styles.label}>Your application</Text>
            <Text style={{ fontFamily: fonts.displayX, fontSize: 22, color: p.ink }} accessibilityRole="header">{st.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: p.muted }}>{st.text}</Text>
            {applying ? (
              <View style={{ gap: 10, marginTop: 6 }}>
                <Step n={1} title="Account" done />
                <Step n={2} title="Service area" sub={user.partner && user.partner.serviceAreaSet ? "Set" : "Where you'll travel for jobs"} done={!!(user.partner && user.partner.serviceAreaSet)} onPress={() => router.push("/service-area")} testID="step-area" />
                <Step n={3} title="Services you offer" sub={user.partner && user.partner.servicesCount ? `${user.partner.servicesCount} turned on` : "Pick the work you do"} done={!!(user.partner && user.partner.servicesCount)} onPress={() => router.push("/services")} testID="step-services" />
                {LATER.map((s, i) => <Step key={s} n={i + 4} title={s} />)}
                <Notice style={{ marginTop: 4, backgroundColor: p.panel2 }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: p.ink }}>Steps 4 to 10 open in upcoming updates. You'll finish everything here in the app; nothing else is needed from you yet.</Text>
                </Notice>
              </View>
            ) : null}
          </View>
          ) : null}

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
