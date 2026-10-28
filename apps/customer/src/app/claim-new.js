// Report damage from a visit. Photos are required; we compare them with the partner's check-in photos.
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Button, Chips, Field, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { PhotoPicker } from "../components/Care";

const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function NewClaim() {
  const t = useTheme();
  const router = useRouter();
  const { jobId } = useLocalSearchParams();
  const { call } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [job, setJob] = useState(jobId ? String(jobId) : null);
  const [damageTo, setDamageTo] = useState("vehicle");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState([]);
  const [wants, setWants] = useState("repair");
  const [estimate, setEstimate] = useState("");
  const [err, setErr] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useEffect(() => { call("claims").then((r) => setJobs(r.jobs)).catch((e) => setErr(e.message)); }, [call]);

  async function submit() {
    setErr(null); setFields({});
    setBusy(true);
    try {
      const r = await call("fileClaim", { jobId: job, damageTo, description, photos, wants, estimate: estimate.trim() || undefined });
      router.replace({ pathname: "/claim", params: { id: r.claim.id } });
    } catch (e) { setErr(e.code === "invalid_input" ? null : e.message); setFields(e.fields || {}); setBusy(false); }
  }

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <T v="h1" accessibilityRole="header">Report damage</T>
        {!jobs ? (err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} />) : !jobs.length ? (
          <Notice>There are no visits from the last 30 days to report on. For anything older, chat with support.</Notice>
        ) : (
          <>
            <Chips label="Which visit?" value={job} onChange={setJob} options={jobs.map((j) => [j.id, `${day(j.completedAt)} · ${j.services.join(", ")}${j.partner ? ` · ${j.partner}` : ""}`])} error={fields.jobId} testID="cl-job" />
            <Chips label="What was damaged?" value={damageTo} onChange={setDamageTo} options={[["vehicle", "My vehicle"], ["property", "My property (driveway, garage)"], ["other", "Something else"]]} error={fields.damageTo} testID="cl-what" />
            <Field label="What happened?" value={description} onChangeText={setDescription} multiline placeholder="Where the damage is and when you noticed it" error={fields.description} testID="cl-desc" />
            <PhotoPicker label="Photos of the damage (required)" value={photos} onChange={setPhotos} max={6} hint="Close-up and wide shots both help." error={fields.photos} />
            <Chips label="What would make it right?" value={wants} onChange={setWants} options={[["repair", "Repair"], ["reimbursement", "Reimbursement"], ["not_sure", "Not sure"]]} error={fields.wants} />
            <Field label="Repair estimate, if you have one ($)" value={estimate} onChangeText={setEstimate} keyboardType="decimal-pad" placeholder="420" error={fields.estimate} testID="cl-est" />
            <Notice>We compare the check-in photos your partner took before starting with your photos. Every Auto-Auto job is insured, including damage to your vehicle and property. Your partner gets 48 hours to respond, and we decide within 5 business days after that.</Notice>
            {err ? <Notice tone="bad">{err}</Notice> : null}
            <Button title="Submit claim" big loading={busy} disabled={!job} onPress={submit} testID="cl-submit" />
          </>
        )}
      </View>
    </Screen>
  );
}
