// Business & tax: legal name, how you're paid, address, employees, e-sign consent, and the W-9 certification.
// The SSN or EIN itself is entered on Stripe's page in Payouts; Auto-Auto never stores it.
import { Text, View } from "react-native";
import { Attest, Input, Pick, Section, SignBox, StepScreen, body, muted, useApplication } from "../../components/Onboarding";
import { p } from "../../theme";

export default function Business() {
  const a = useApplication("business");
  const { app, form, set, err, busy } = a;
  const locked = app && app.locked;
  const esigned = !!(app && app.signatures.esign);
  return (
    <StepScreen title="Business & tax" app={app} step={a.step} err={err} onSave={() => a.save()} saving={busy === "save"} saved={a.saved}>
      {app ? (
        <>
          <Section title="Your legal name">
            <Text style={muted}>As it appears on your driver's license. You'll sign documents with it.</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Input form={form} set={set} k="legalFirst" err={err} label="First" style={{ flex: 1 }} autoCapitalize="words" />
              <Input form={form} set={set} k="legalLast" err={err} label="Last" style={{ flex: 1 }} autoCapitalize="words" />
            </View>
            <Input form={form} set={set} k="legalMiddle" err={err} label="Middle (optional)" autoCapitalize="words" />
          </Section>

          <Section title="How you'll get paid">
            <Pick value={form.entity} onChange={set("entity")} testID="f-entity" options={[["individual", "Individual / sole proprietor"], ["smllc", "Single-member LLC"], ["llc", "Multi-member LLC or partnership"], ["corp", "Corporation"]]} />
            {form.entity && form.entity !== "individual"
              ? <Input form={form} set={set} k="businessName" err={err} label="Business legal name" />
              : <Input form={form} set={set} k="dba" err={err} label="Business name you use (optional)" />}
            <Text style={muted}>Your SSN or EIN is entered on Stripe's secure page when you set up payouts. Auto-Auto never sees or stores it.</Text>
          </Section>

          <Section title="Address">
            <Input form={form} set={set} k="street" err={err} label="Business or home address" autoComplete="street-address" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Input form={form} set={set} k="city" err={err} label="City" style={{ flex: 2 }} />
              <Input form={form} set={set} k="state" err={err} label="State" style={{ flex: 1 }} autoCapitalize="characters" maxLength={2} placeholder="TN" />
              <Input form={form} set={set} k="zip" err={err} label="ZIP" style={{ flex: 1.3 }} keyboardType="number-pad" maxLength={5} />
            </View>
            <Pick label="People who work for you" value={form.employees} onChange={set("employees")} testID="f-employees" options={[["0", "Just me"], ["1-4", "1–4"], ["5+", "5 or more"]]} />
          </Section>

          <Section title="Electronic signatures">
            {esigned ? <Text style={[muted, { color: p.ok }]}>✓ You agreed to sign and receive documents electronically.</Text> : (
              <Attest value={false} testID="f-esign" onChange={() => a.sign("esign")}>
                I agree to sign and receive documents electronically. I can get paper copies or withdraw this consent anytime by contacting support. Withdrawing ends my ability to use the app. I have a device that can open and save PDF files. (E-SIGN Act, 15 U.S.C. § 7001)
              </Attest>
            )}
          </Section>

          <Section title="W-9 certification">
            <Text style={body}>Under penalties of perjury, I certify that: (1) the taxpayer ID number I give for my payouts is correct; (2) I am not subject to backup withholding, or the IRS has told me I'm no longer subject to it; (3) I am a U.S. citizen or other U.S. person; and (4) any FATCA codes entered are correct.</Text>
            <Text style={muted}>Save your legal name first, then sign.</Text>
            <SignBox docId="w9" app={app} locked={locked} busy={busy === "sign-w9"} err={err} onSign={a.sign} />
          </Section>
        </>
      ) : null}
    </StepScreen>
  );
}
