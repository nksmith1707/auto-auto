// Report damage, an injury, or an unsafe situation (partner agreement: within 24 hours, with photos for damage).
import { useCallback, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { fmtWhen } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Chips, Field, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { SmallButton, card, label, muted } from "../components/Onboarding";
import { takePhoto } from "../components/Photos";
import { fonts, p } from "../theme";

const TYPES = [["vehicle_damage", "Damage to customer vehicle"], ["property_damage", "Damage to customer property"], ["injury", "Someone got hurt"], ["unsafe", "Unsafe situation"], ["customer_behavior", "Customer behavior"]];

export default function Incident() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { call, api } = useAuth();
  const [type, setType] = useState(null);
  const [jobId, setJobId] = useState(params.jobId ? String(params.jobId) : null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState([]); // { contentType, data }
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useFocusEffect(useCallback(() => { call("incidents").then(setData).catch(() => {}); }, [call]));

  async function add(library) {
    setErr(null);
    try { const shot = await takePhoto({ library }); if (shot) setPhotos((x) => [...x, shot].slice(0, 4)); } catch (e) { setErr(e.message); }
  }
  async function submit() {
    setErr(null);
    if (!type) return setErr("Choose what happened.");
    if (description.trim().length < 15) return setErr("Describe what happened in a couple of sentences.");
    if (type.endsWith("_damage") && !photos.length) return setErr("Add at least one photo of the damage.");
    setBusy(true);
    try {
      const r = await call("reportIncident", { type, jobId: jobId || undefined, description, photos });
      setSent(r.incident);
      setType(null); setDescription(""); setPhotos([]);
      setData(await call("incidents"));
    } catch (e) { setErr(e.fields ? Object.values(e.fields).filter(Boolean)[0] || e.message : e.message); }
    finally { setBusy(false); }
  }

  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title="Report an incident" />
      <View style={{ gap: 14 }}>
        {sent ? <Notice tone="ok">Report sent. Our team will contact you within 1 business day.</Notice> : null}
        <Chips label="What happened?" value={type} onChange={setType} options={TYPES} testID="incident-type" />
        {type === "injury" || type === "unsafe" ? <Notice tone="bad">If anyone is in danger, call 911 first. Then finish this report.</Notice> : null}
        {data && data.jobs.length ? (
          <Chips label="Job" value={jobId} onChange={setJobId} allowNone
            options={data.jobs.map((j) => [j.id, `${fmtWhen(j.when)} · ${j.services.join(", ")}`])} testID="incident-job" />
        ) : null}
        <Field label="Describe it" value={description} onChangeText={setDescription} multiline maxLength={2000}
          placeholder="What happened, where, and what you did right after" testID="incident-description" />
        <View style={[card, { gap: 10 }]}>
          <Text style={label}>Photos {type && type.endsWith("_damage") ? "(required)" : "(optional)"}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {photos.map((x, i) => <Image key={i} source={{ uri: `data:${x.contentType};base64,${x.data}` }} style={{ width: 72, height: 72, borderRadius: 10 }} />)}
          </View>
          {photos.length < 4 ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {Platform.OS !== "web" ? <SmallButton title="Take photo" onPress={() => add(false)} /> : null}
              <SmallButton title="Choose photo" onPress={() => add(true)} testID="incident-photo" />
            </View>
          ) : null}
        </View>
        <Text style={muted}>Report damage within 24 hours. Reporting it yourself, with photos, counts in your favor when the claim is reviewed.</Text>
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <Button title="Submit report" onPress={submit} loading={busy} testID="incident-submit" />

        {data && data.incidents.length ? (
          <View style={[card, { gap: 10 }]}>
            <Text style={label}>Your reports</Text>
            {data.incidents.map((r) => (
              <View key={r.id} style={{ gap: 2 }}>
                <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.ink }}>{r.typeLabel} · {r.status === "open" ? "Open" : "Closed"}</Text>
                <Text style={muted}>{fmtWhen(r.createdAt)} · {r.photos.length} photo{r.photos.length === 1 ? "" : "s"}</Text>
                {r.staffNote ? <Text style={muted}>Our team: {r.staffNote}</Text> : null}
                {r.photos.length ? <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>{r.photos.map((x) => <Image key={x.id} source={{ uri: api.url(x.url) }} style={{ width: 48, height: 48, borderRadius: 8 }} />)}</View> : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
