// Free warranty return: tell us what's wrong and pick a time. The original partner gets first chance to come back.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { bookingDays, fmtDay, fmtTime } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Chips, Field, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { PhotoPicker } from "../components/Care";

const ISSUES = [["same_problem", "Same problem is back"], ["new_noise", "New noise or leak since the repair"], ["warning_light", "Warning light came on"], ["loose_missing", "Something was left loose or missing"]];
const longDay = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export default function Warranty() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [job, setJob] = useState(null);
  const [err, setErr] = useState(null);
  const [fields, setFields] = useState({});
  const [issue, setIssue] = useState(null);
  const [details, setDetails] = useState("");
  const [photos, setPhotos] = useState([]);
  const days = useMemo(() => bookingDays(), []);
  const [day, setDay] = useState(days[0] ? days[0].day : null);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useEffect(() => { call("job", String(id)).then((r) => setJob(r.job)).catch((e) => setErr(e.message)); }, [call, id]);
  if (!job) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  const daySlots = (days.find((d) => d.day === day) || { slots: [] }).slots;
  const lines = (job.final || job.quote).lines;

  async function submit() {
    setErr(null); setFields({});
    if (!issue) { setFields({ issue: "Tell us what's happening." }); return; }
    if (!slot) { setFields({ windowStart: "Pick a day and arrival window." }); return; }
    setBusy(true);
    try {
      const r = await call("requestWarranty", job.id, { issue, details: details.trim() || undefined, windowStart: slot, photos });
      router.replace({ pathname: "/job", params: { id: r.job.id, fresh: "1" } });
    } catch (e) { setErr(e.code === "invalid_input" ? null : e.message); setFields(e.fields || {}); setBusy(false); }
  }

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <T v="h1" accessibilityRole="header">Warranty return</T>
        <Notice tone="ok">{`Covered until ${longDay(job.care.warrantyUntil)}${job.warrantyMilesUntil ? ` or ${job.warrantyMilesUntil.toLocaleString("en-US")} miles` : ""}. ${job.partner ? job.partner.name : "Your partner"} comes back and fixes it at no charge. If they can't, another partner does, and Auto-Auto covers it.`}</Notice>
        <T v="small">Original visit: {lines.map((l) => l.name).join(", ")}</T>
        <Chips label="What's happening?" value={issue} onChange={setIssue} options={ISSUES} error={fields.issue} testID="wr-issue" />
        <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline placeholder="What you notice and when" error={fields.details} testID="wr-details" />
        <PhotoPicker label="Photos or video stills (optional)" value={photos} onChange={setPhotos} max={4} hint="Optional, but it speeds things up." error={fields.photos} />
        <Chips label="Day" value={day} onChange={(d) => { setDay(d); setSlot(null); }} options={days.map((d) => [d.day, fmtDay(d.day)])} />
        <Chips label="Arrival window" value={slot} onChange={setSlot} options={daySlots.map((s) => [s, `${fmtTime(s)}–${fmtTime(s + 7_200_000)}`])} error={fields.windowStart} testID="wr-slots" />
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <Button title="Request free warranty return" big loading={busy} onPress={submit} testID="wr-submit" />
      </View>
    </Screen>
  );
}
