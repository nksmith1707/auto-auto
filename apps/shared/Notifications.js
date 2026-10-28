// The notification inbox and settings (push, text, email for each kind of update), plus the bell with the unread count.
// Both apps use these; each passes its own top bar.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { formatPhone } from "./api";
import { fmtWhen } from "./format";
import { registerPush } from "./push";
import { useAuth } from "./session";
import { Button, Card, Checkbox, Notice, Screen, T, Tabs, useTheme } from "./ui";

// An on/off switch (role "switch" so screen readers say on or off).
export function Switch({ value, onChange, label, testID }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: !!value }} aria-checked={!!value} accessibilityLabel={label} testID={testID} hitSlop={6}
      style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: value ? t.c.brand : t.c.line, justifyContent: "center" }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: value ? "flex-end" : "flex-start" }} />
    </Pressable>
  );
}

// The bell on the home screen. Checks for new notifications while the screen is open.
export function Bell({ onPress, color }) {
  const t = useTheme();
  const { call } = useAuth();
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => { try { setUnread((await call("notifications")).unread); } catch { /* try again next time */ } }, [call]);
  useFocusEffect(useCallback(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]));
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} testID="open-notifications" hitSlop={8}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 22, color: color || t.c.ink }}>🔔</Text>
      {unread ? (
        <View style={{ position: "absolute", top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.c.bad, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
          <Text style={{ color: "#fff", fontFamily: t.f.bodyX, fontSize: 11 }} testID="unread-count">{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Inbox({ onOpen }) {
  const t = useTheme();
  const { call } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => { try { setData(await call("notifications")); setErr(null); } catch (e) { setErr(e.message); } }, [call]);
  useEffect(() => { load(); }, [load]);
  async function open(n) {
    if (!n.read) { try { setData(await call("markRead", [n.id])); } catch { /* still open it */ } }
    if (n.data && n.data.route) onOpen(n.data);
  }
  if (!data) return err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 30 }} />;
  return (
    <View style={{ gap: 10 }}>
      {data.unread ? <Pressable onPress={async () => setData(await call("markRead"))} accessibilityRole="button" style={{ alignSelf: "flex-end" }} testID="mark-all-read"><Text style={t.text.link}>Mark all as read</Text></Pressable> : null}
      {!data.notifications.length ? <T v="muted" style={{ textAlign: "center", marginTop: 20 }}>Nothing yet. Updates about your {t.dark ? "jobs" : "visits"} show up here.</T> : null}
      {data.notifications.map((n) => (
        <Card key={n.id} onPress={() => open(n)} accessibilityLabel={`${n.read ? "" : "Unread. "}${n.title}`} testID="notification" style={[{ gap: 3 }, !n.read && { borderColor: t.c.brand, borderWidth: 1.5 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.c.brand }} /> : null}
            <Text style={[t.text.body, { fontFamily: t.f.bodyX, flex: 1 }]}>{n.title}</Text>
          </View>
          <T v="small">{n.body}</T>
          <T v="hint">{fmtWhen(n.at)}</T>
        </Card>
      ))}
    </View>
  );
}

function Settings() {
  const t = useTheme();
  const { call, user } = useAuth();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [consent, setConsent] = useState(false);
  const [pushMsg, setPushMsg] = useState(null);
  useEffect(() => { call("notificationSettings").then(setS).catch((e) => setErr(e.message)); }, [call]);
  async function save(body, which) {
    setErr(null);
    setBusy(which);
    try { setS(await call("saveNotificationSettings", body)); } catch (e) { setErr(e.fields ? Object.values(e.fields).filter(Boolean).join(" ") : e.message); } finally { setBusy(null); }
  }
  if (!s) return err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 30 }} />;
  const head = { fontFamily: t.f.bodyX, fontSize: 12, color: t.c.muted, width: 52, textAlign: "center" };
  return (
    <View style={{ gap: 14 }}>
      <T v="small">Choose how we reach you for each kind of update. Everything also shows in your inbox here.</T>
      <Card style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 6 }}>
          <View style={{ flex: 1 }} /><Text style={head}>Phone</Text><Text style={head}>Text</Text><Text style={head}>Email</Text>
        </View>
        {s.categories.map((c) => (
          <View key={c.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.c.line }} testID={`pref-${c.id}`}>
            <Text style={[t.text.small, { flex: 1, fontFamily: t.f.bodyB }]}>{c.label}</Text>
            {["push", "sms", "email"].map((ch) => (
              <View key={ch} style={{ width: 52, alignItems: "center", opacity: ch === "sms" && !s.sms.optedIn ? 0.45 : 1 }}>
                <Switch value={c[ch]} label={`${c.label} by ${ch === "push" ? "phone alert" : ch === "sms" ? "text" : "email"}`} testID={`pref-${c.id}-${ch}`}
                  onChange={(v) => save({ categories: { [c.id]: { [ch]: v } } }, `${c.id}-${ch}`)} />
              </View>
            ))}
          </View>
        ))}
      </Card>
      {err ? <Notice tone="bad">{err}</Notice> : null}

      <Card style={{ gap: 8 }}>
        <T v="title">Text messages</T>
        {s.sms.optedIn ? (
          <>
            <T v="small">Texts go to {formatPhone(s.sms.phone)} for the updates switched on above. Reply STOP to any text to stop them.</T>
            <Button title="Turn off texts" variant="ghost" loading={busy === "sms"} onPress={() => save({ smsOptIn: false }, "sms")} testID="sms-off" />
          </>
        ) : !s.sms.canText ? (
          <T v="small">Add your mobile number to your account first, then come back to turn on texts.</T>
        ) : (
          <>
            <Checkbox checked={consent} onChange={setConsent} testID="sms-consent">
              Text me updates at {formatPhone(s.sms.phone)}. Message and data rates may apply. How often depends on your visits. Reply STOP to opt out or HELP for help. Consent isn't required to use Auto-Auto.
            </Checkbox>
            <Button title="Turn on texts" disabled={!consent} loading={busy === "sms"} onPress={() => save({ smsOptIn: true }, "sms")} testID="sms-on" />
          </>
        )}
        {!s.sms.connected ? <T v="hint">Texts start once Auto-Auto finishes connecting its texting service. Your choice is saved until then.</T> : null}
      </Card>

      <Card style={{ gap: 8 }}>
        <T v="title">Email</T>
        <T v="small">Emails go to {s.email.address || (user && user.email)}.</T>
        {!s.email.connected ? <T v="hint">Emails start once Auto-Auto finishes connecting its email service. Your choice is saved until then.</T> : null}
      </Card>

      <Card style={{ gap: 8 }}>
        <T v="title">Phone alerts</T>
        <T v="small">{s.push.devices ? `On for ${s.push.devices} phone${s.push.devices === 1 ? "" : "s"}.` : "Not set up on this phone yet."}</T>
        <Button title={s.push.devices ? "Set up again on this phone" : "Turn on phone alerts"} variant="ghost" loading={busy === "push"} testID="push-on"
          onPress={async () => {
            setBusy("push"); setPushMsg(null);
            const r = await registerPush(call);
            setPushMsg(r.ok ? "Phone alerts are on." : r.reason);
            try { setS(await call("notificationSettings")); } catch { /* keep what we have */ }
            setBusy(null);
          }} />
        {pushMsg ? <Notice tone={pushMsg === "Phone alerts are on." ? "ok" : "info"}>{pushMsg}</Notice> : null}
      </Card>
    </View>
  );
}

export function NotificationsScreen({ top, onOpen, background, style }) {
  const [tab, setTab] = useState("inbox");
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const t = useTheme();
  return (
    <Screen background={background} style={style} contentStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.c.muted} onRefresh={() => { setRefreshing(true); setRefreshKey((k) => k + 1); setTimeout(() => setRefreshing(false), 400); }} />}>
      {top}
      <View style={{ gap: 14 }}>
        <T v="h1" accessibilityRole="header">Notifications</T>
        <Tabs value={tab} onChange={setTab} options={[["inbox", "Inbox"], ["settings", "Settings"]]} />
        {tab === "inbox" ? <Inbox key={refreshKey} onOpen={onOpen} /> : <Settings key={refreshKey} />}
      </View>
    </Screen>
  );
}
