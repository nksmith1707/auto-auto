// One damage claim: the customer's report and photos, your check-in photos, and your response.
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtWhen } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Field, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

const label = { fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" };
const card = { backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, padding: 16, gap: 8 };

function Thumbs({ photos }) {
  const { api } = useAuth();
  if (!photos || !photos.length) return <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>None.</Text>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {photos.map((x) => (
        <View key={x.id} style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden", backgroundColor: p.panel2, borderWidth: x.damageNote ? 2 : 0, borderColor: p.bad }}>
          <Image source={{ uri: api.url(x.url) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityLabel={x.label} />
        </View>
      ))}
    </View>
  );
}

export default function Claim() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { call } = useAuth();
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const load = useCallback(async () => { try { setC((await call("claim", String(id))).claim); setErr(null); } catch (e) { setErr(e.message); } }, [call, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!c) return <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }}><TopBar onBack={back} title="Claim" />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brandText} style={{ marginTop: 40 }} />}</Screen>;
  const jp = c.jobPhotos || { checkin: [], after: [], damage: [] };
  async function respond() {
    setErr(null); setBusy(true);
    try { setC((await call("respondClaim", c.id, text)).claim); } catch (e) { setErr(e.fields && e.fields.response ? e.fields.response : e.message); } finally { setBusy(false); }
  }
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title={c.number} />
      <View style={{ gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.displayX, fontSize: 24, color: p.ink }} accessibilityRole="header">{c.damageToLabel}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.muted }}>{c.customer} · {c.job.services.join(", ")} · filed {fmtWhen(c.createdAt)}</Text>
        </View>
        <View style={card}>
          <Text style={label}>What the customer says</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink }}>{c.description}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>Asks for: {c.wantsLabel}{c.estimateCents ? ` · estimate ${money(c.estimateCents, { always: true })}` : ""} · Coverage: {c.coverageLabel}</Text>
          <Thumbs photos={c.photos} />
        </View>
        <View style={card}>
          <Text style={label}>Your check-in photos (before work)</Text>
          <Thumbs photos={jp.checkin} />
          {jp.damage && jp.damage.length ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.money }}>You noted: {jp.damage.map((d) => `${d.label}: ${d.note}`).join("; ")}</Text> : null}
          <Text style={label}>After photos</Text>
          <Thumbs photos={jp.after} />
        </View>
        {c.status === "closed" ? (
          <Notice tone={c.decision.outcome === "deny" ? "ok" : "info"}>{`Decision: ${c.decision.outcomeLabel}${c.decision.amountCents ? ` · ${money(c.decision.amountCents, { always: true })}` : ""}. ${c.decision.note}`}</Notice>
        ) : c.partnerResponse ? (
          <View style={card}>
            <Text style={label}>Your response</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink }}>{c.partnerResponse}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>We decide within 5 business days. This job's pay is held until then; the rest of your balance pays out as usual.</Text>
          </View>
        ) : c.status === "partner" ? (
          <View style={[card, { borderColor: p.money, borderWidth: 2 }]}>
            <Text style={label}>Your side · due {fmtWhen(c.responseDueAt)}</Text>
            <Field label="What happened" value={text} onChangeText={setText} multiline placeholder="Was the damage there before? Point to your check-in photos and notes." testID="claim-response" />
            {err ? <Notice tone="bad">{err}</Notice> : null}
            <Button title="Send response" variant="money" loading={busy} onPress={respond} testID="claim-respond" />
          </View>
        ) : <Notice>The 48 hours to respond ran out. We're deciding with the evidence on file.</Notice>}
        <Pressable onPress={() => router.push({ pathname: "/job", params: { id: c.jobId } })} accessibilityRole="button"><Text style={{ fontFamily: fonts.bodyX, fontSize: 14, color: p.brandText, textAlign: "center" }}>Open the job ›</Text></Pressable>
      </View>
    </Screen>
  );
}
