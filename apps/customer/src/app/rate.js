// Rate your service: stars, what stood out, a review, a tip (100% to the partner, for 24 hours), and a favorite.
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Card, Checkbox, Chips, Field, Notice, Screen, T, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { STAR_LABEL, Stars, TagChips } from "../components/Care";

const POS = ["On time", "Professional", "Clean work", "Fair price", "Great communication", "Explained the work"];
const NEG = ["Arrived late", "Left a mess", "Work not finished", "Price changed", "Hard to reach", "Rude"];

export default function Rate() {
  const t = useTheme();
  const router = useRouter();
  const { id, tipOnly } = useLocalSearchParams();
  const { call } = useAuth();
  const [job, setJob] = useState(null);
  const [err, setErr] = useState(null);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState([]);
  const [review, setReview] = useState("");
  const [note, setNote] = useState("");
  const [tip, setTip] = useState(0);
  const [fav, setFav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  useEffect(() => { call("job", String(id)).then((r) => setJob(r.job)).catch((e) => setErr(e.message)); }, [call, id]);

  if (!job) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  const name = job.partner ? job.partner.name : "your partner";
  const first = name.split(" ")[0];
  const total = (job.final && job.final.totalCents) || 0;
  const tipOpen = Date.now() < job.care.tipOpenUntil && !job.care.tip;
  const tipOptions = [[0, "No tip"], ...[15, 20, 25].map((pct) => [Math.max(100, Math.round((total * pct) / 100)), `${pct}% · ${money(Math.max(100, Math.round((total * pct) / 100)), { always: true })}`])];

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      if (tipOnly) {
        const r = await call("tipJob", job.id, tip);
        setDone({ tipOnly: true, tip: r.tip });
      } else {
        const r = await call("rateJob", job.id, { stars, tags, review: review.trim() || undefined, privateNote: note.trim() || undefined, tipCents: tipOpen ? tip : 0, favorite: fav });
        setDone({ stars, tip: r.tip, favorite: fav });
      }
    } catch (e) { setErr(e.fields && Object.keys(e.fields).length ? Object.values(e.fields).filter(Boolean).join(" ") : e.message); }
    finally { setBusy(false); }
  }

  if (done) {
    const tipFailed = done.tip && done.tip.status === "failed";
    return (
      <Screen contentStyle={{ paddingBottom: 32 }}>
        <TopBar onBack={back} />
        <View style={{ gap: 14, alignItems: "stretch" }}>
          <T v="h1" style={{ textAlign: "center" }} accessibilityRole="header" testID="rated">{done.tipOnly ? "Thanks for the tip!" : "Thanks for your review!"}</T>
          {!done.tipOnly ? <Stars value={done.stars} /> : null}
          {!done.tipOnly ? <T v="small" style={{ textAlign: "center" }}>Your rating is on {first}'s profile.</T> : null}
          {done.tip && !tipFailed ? <Notice tone="ok">{`Your ${money(done.tip.amountCents, { always: true })} tip goes straight to ${first}.`}</Notice> : null}
          {tipFailed ? <Notice tone="bad">{`The tip didn't go through: ${done.tip.message || "your card was declined"}. You can try again from the visit for 24 hours.`}</Notice> : null}
          {done.favorite ? <Notice>{`${first} is now a favorite. They get first chance at your requests.`}</Notice> : null}
          {done.stars && done.stars <= 2 ? <Notice>Sorry it didn't go well. Our support team will reach out within one business day.</Notice> : null}
          <Button title="Back to the visit" onPress={() => router.replace({ pathname: "/job", params: { id: job.id } })} testID="rated-done" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <View style={{ alignItems: "center", gap: 4 }}>
          <T v="h1" accessibilityRole="header">{tipOnly ? `Tip ${first}` : `How did ${first} do?`}</T>
          <T v="muted" style={{ textAlign: "center" }}>{job.final.lines.map((l) => l.name).join(", ")} · {job.vehicle.year} {job.vehicle.make} {job.vehicle.model}</T>
        </View>
        {!tipOnly ? (
          <>
            <View style={{ gap: 4 }}>
              <Stars value={stars} onChange={(n) => { setStars(n); setTags([]); }} />
              <T v="small" style={{ textAlign: "center", fontFamily: t.f.bodyB }}>{STAR_LABEL[stars]}</T>
            </View>
            {stars ? (
              <View style={{ gap: 6 }}>
                <T v="label">{stars >= 4 ? "What stood out?" : "What went wrong?"}</T>
                <TagChips options={(stars >= 4 ? POS : NEG).map((x) => [x, x])} value={tags} onChange={setTags} testID="rate-tags" />
              </View>
            ) : null}
            <Field label="Write a review (optional)" value={review} onChangeText={setReview} multiline placeholder={`Tell other drivers what it was like. This shows on ${first}'s profile.`} testID="rate-review" />
          </>
        ) : null}
        {tipOpen ? (
          <View style={{ gap: 6 }}>
            <Chips label="Add a tip" value={tip} onChange={setTip} options={tipOnly ? tipOptions.slice(1) : tipOptions} testID="rate-tip" />
            <T v="hint">100% of tips go to {first}. Tips are open for 24 hours after the visit and charged to your card on file.</T>
          </View>
        ) : !tipOnly && job.care.tip ? <Notice tone="ok">{`You tipped ${money(job.care.tip.amountCents, { always: true })}. Thank you!`}</Notice> : null}
        {!tipOnly ? (
          <>
            <Checkbox checked={fav} onChange={setFav} testID="rate-fav">Make {first} my favorite. Favorites get first chance at your requests.</Checkbox>
            <Field label="Private note to Auto-Auto (not shown to your partner)" value={note} onChangeText={setNote} multiline placeholder="Anything our team should know" />
          </>
        ) : null}
        <Card style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="small">Visit total</T><T v="small">{money(total, { always: true })}</T></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="small">Tip</T><T v="small">{money(tip, { always: true })}</T></View>
        </Card>
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <Button title={tipOnly ? `Send ${money(tip, { always: true })} tip` : "Submit review"} big disabled={tipOnly ? !tip : !stars} loading={busy} onPress={submit} testID="rate-submit" />
      </View>
    </Screen>
  );
}
