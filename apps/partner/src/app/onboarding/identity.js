// Identity & driving: license details, then Stripe checks the license photo and a matching selfie.
// Auto-Auto keeps only the result (verified, and 21 or older), not the photos, license number, or birth date.
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { openStripePage } from "../../../../shared/stripePage";
import { Button } from "../../../../shared/ui";
import { DateInput, Input, Pick, Section, StepScreen, muted, useApplication } from "../../components/Onboarding";
import { fonts, p } from "../../theme";

const ID_STATUS = {
  not_started: ["Not started", p.muted], requires_input: ["Not finished", p.money], processing: ["Checking…", p.brandText],
  verified: ["Verified", p.ok], canceled: ["Canceled. Start again", p.money], failed: ["Couldn't verify. Start again", p.bad],
};

export default function Identity() {
  const a = useApplication("identity");
  const { app, form, set, err, busy, call } = a;
  const params = useLocalSearchParams();
  const [problem, setProblem] = useState(null);
  const [checked, setChecked] = useState(false);
  const sync = () => a.run("sync", () => call("syncIdentity")).then((s) => setProblem((s && s.identity.problem) || null));
  // Back from Stripe's page (on the web the app reloads here with ?done=1), or opening this step with a check
  // already started: ask Stripe how it went.
  useEffect(() => {
    if (!app || checked) return;
    if (params.done || ["requires_input", "processing"].includes(app.identity.status)) { setChecked(true); sync(); }
  }, [app, params.done]); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify() {
    setProblem(null);
    await a.save();
    const s = await a.run("verify", async () => {
      await openStripePage("/onboarding/identity", (returnUrl) => call("startIdentity", returnUrl));
      return call("syncIdentity");
    });
    if (s) setProblem(s.identity.problem || null);
  }

  const id = app ? app.identity : null;
  const [stLabel, stColor] = id ? ID_STATUS[id.status] || ID_STATUS.not_started : ID_STATUS.not_started;
  return (
    <StepScreen title="Identity & driving" app={app} step={a.step} err={err} onSave={() => a.save()} saving={busy === "save"} saved={a.saved}>
      {app ? (
        <>
          <Section title="Your driver's license">
            <Text style={muted}>You need to be 21 or older with a license held for 2+ years.</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Input form={form} set={set} k="dlState" err={err} label="Issuing state" style={{ flex: 1 }} autoCapitalize="characters" maxLength={2} placeholder="TN" />
              <DateInput form={form} set={set} k="dlExpires" err={err} label="Expires" style={{ flex: 1.6 }} hint={undefined} />
            </View>
            <Pick label="Years licensed" value={form.yearsLicensed} onChange={set("yearsLicensed")} testID="f-yearsLicensed" options={[["1", "Under 2"], ["2", "2–4"], ["5", "5–9"], ["10", "10+"]]} />
          </Section>

          <Section title="Verify your ID">
            <Text style={muted}>Stripe, our identity partner, asks for a photo of your license and a quick selfie, and checks that they match. Auto-Auto never sees or stores the photos or your license number.</Text>
            <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: stColor }} testID="id-status">Status: {stLabel}{id && id.status === "verified" && id.over21 === false ? " · under 21" : ""}</Text>
            {problem ? <Text style={[muted, { color: p.bad }]}>{problem}</Text> : null}
            {!id.enabled ? <Text style={muted}>ID checks aren't turned on yet. Partner support will verify you instead.</Text>
              : id.status === "processing" ? <Button title="Check again" variant="ghost" onPress={sync} loading={busy === "sync"} testID="check-id" />
              : id.status !== "verified" && !app.locked ? <Button title={id.status === "not_started" ? "Verify with Stripe" : "Continue ID check"} variant="money" onPress={verify} loading={busy === "verify" || busy === "sync"} testID="verify-id" /> : null}
          </Section>
        </>
      ) : null}
    </StepScreen>
  );
}
