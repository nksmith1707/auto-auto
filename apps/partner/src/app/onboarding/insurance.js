// Insurance: how you're covered (Partner Protection, split, or your own), policy details, and certificates.
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Attest, DateInput, Input, Pick, Section, StepScreen, Upload, body, card, h3, muted, useApplication } from "../../components/Onboarding";
import { Button } from "../../../../shared/ui";
import { fonts, p } from "../../theme";

const OPTIONS = [
  ["aa", "Auto-Auto Partner Protection", "Recommended · $0 to you", ["General liability and garagekeepers while you're on an Auto-Auto job, from Start trip to Complete", "Paid by the customer's $3 service protection fee", "If a claim is your fault, you pay a $500 deductible"]],
  ["split", "My liability + Auto-Auto garagekeepers", "+$1 per job", ["Your general liability covers injuries and property", "Partner Protection covers the customer's vehicle", "You get a $1 credit on every job"]],
  ["own", "Use my own insurance (opt out)", "+$3 per job", ["Your policies cover everything, with Auto-Auto as additional insured", "You sign the Own Insurance Election & Indemnity", "You get the full $3 protection fee as a credit on every job"]],
];

function Policy({ prefix, a, children }) {
  return (
    <>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Input form={a.form} set={a.set} k={`${prefix}Carrier`} err={a.err} label="Insurance company" style={{ flex: 1 }} />
        <Input form={a.form} set={a.set} k={`${prefix}Policy`} err={a.err} label="Policy number" style={{ flex: 1 }} autoCapitalize="characters" />
      </View>
      <DateInput form={a.form} set={a.set} k={`${prefix}Expires`} err={a.err} label="Expiration date" hint="Must be at least 30 days away" />
      {children}
    </>
  );
}

export default function Insurance() {
  const router = useRouter();
  const a = useApplication("insurance");
  const { app, form, set, err, busy } = a;
  const cov = form.coverage;
  const employees = app && (app.answers.business || {}).employees;
  const up = (kind, title, hint) => <Upload kind={kind} title={title} hint={hint} app={app} locked={app.locked} onUploaded={a.setApp} />;
  return (
    <StepScreen title="Insurance" app={app} step={a.step} err={err} onSave={() => a.save()} saving={busy === "save"} saved={a.saved}>
      {app ? (
        <>
          <Text style={body}>Every Auto-Auto job is insured. Choose how you're covered. You can switch later.</Text>
          {OPTIONS.map(([v, t, tag, pts]) => {
            const on = cov === v;
            return (
              <Pressable key={v} onPress={() => set("coverage")(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`cov-${v}`}
                style={[card, { gap: 6, borderWidth: on ? 2 : 1, borderColor: on ? p.brand : p.line }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={[h3, { flex: 1 }]}>{t}</Text>
                  <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: v === "aa" ? p.ok : p.money }}>{tag}</Text>
                </View>
                {pts.map((x) => <Text key={x} style={muted}>• {x}</Text>)}
              </Pressable>
            );
          })}

          {cov === "aa" || cov === "split" ? (
            <Section title="Partner Protection terms">
              <Text style={muted}>Placeholder terms until the policy is bound with an insurer.</Text>
              {["Covers only time on Auto-Auto jobs, Start trip to Complete.", `Limits: ${cov === "split" ? "your general liability applies; " : "$1,000,000 general liability per occurrence; "}$100,000 garagekeepers per occurrence.`,
                "$500 deductible per at-fault claim, taken from your payouts, never more than 25% of any one payout.", "Doesn't cover your tools, your own vehicle, or your own injuries.", "Check-in and after photos are required. Skipping them can void coverage for that job."].map((x) => <Text key={x} style={body}>• {x}</Text>)}
              <Attest value={form.ppTerms} onChange={set("ppTerms")} testID="f-ppTerms">I understand Partner Protection's limits, the $500 deductible, and that it covers Auto-Auto jobs only.</Attest>
            </Section>
          ) : null}

          {cov === "split" || cov === "own" ? (
            <Section title="Your general liability">
              <Text style={muted}>Covers injuries and property damage from your work, like oil spilled on a driveway. Minimum $1,000,000 per occurrence and $2,000,000 aggregate.</Text>
              <Pick label="Per occurrence" value={form.glOccurrence} onChange={set("glOccurrence")} options={[["500000", "$500K"], ["1000000", "$1M"], ["2000000", "$2M"]]} testID="f-glOccurrence" />
              <Pick label="Aggregate" value={form.glAggregate} onChange={set("glAggregate")} options={[["1000000", "$1M"], ["2000000", "$2M"], ["3000000", "$3M"]]} testID="f-glAggregate" />
              <Policy prefix="gl" a={a}>
                <Attest value={form.glAdditionalInsured} onChange={set("glAdditionalInsured")} testID="f-glAdditionalInsured">Auto-Auto, Inc. is named as an additional insured on this policy.</Attest>
                {up("gl", "Certificate of insurance (COI)")}
              </Policy>
            </Section>
          ) : null}

          {cov === "own" ? (
            <>
              <Section title="Your garagekeepers">
                <Text style={muted}>Covers damage to a customer's vehicle while it's in your care. Minimum $100,000 per occurrence.</Text>
                <Pick label="Limit per occurrence" value={form.gkLimit} onChange={set("gkLimit")} options={[["50000", "$50K"], ["100000", "$100K"], ["250000", "$250K"]]} testID="f-gkLimit" />
                <Policy prefix="gk" a={a}>
                  <Attest value={form.gkAtCustomer} onChange={set("gkAtCustomer")} testID="f-gkAtCustomer">My garagekeepers coverage applies at customer locations, not only at a shop.</Attest>
                  {up("gk", "Certificate of insurance (COI)")}
                </Policy>
              </Section>
              <Section title="Own Insurance Election & Indemnity" style={{ borderColor: app.signatures.optout ? p.ok : p.money }}>
                <Text style={muted}>Confirms your insurance pays first, names Auto-Auto as additional insured, and releases Auto-Auto from any gap in your coverage.</Text>
                <Button title={app.signatures.optout ? "View signed document" : "Read and sign"} variant="ghost" onPress={() => router.push({ pathname: "/onboarding/document", params: { id: "optout" } })} testID="open-optout" />
              </Section>
            </>
          ) : null}

          {cov ? (
            <Section title="Vehicle you drive to jobs">
              <Text style={muted}>Required for everyone. Personal auto policies often exclude business use, so you need a commercial policy or a business-use endorsement.</Text>
              <Pick value={form.autoType} onChange={set("autoType")} options={[["commercial", "Commercial auto policy"], ["bizuse", "Personal policy + business use"]]} testID="f-autoType" />
              {form.autoType === "commercial" ? <Pick label="Combined single limit" value={form.autoLimit} onChange={set("autoLimit")} options={[["300000", "$300K"], ["500000", "$500K"], ["1000000", "$1M"]]} testID="f-autoLimit" /> : null}
              {form.autoType === "bizuse" ? <Attest value={form.autoBizUse} onChange={set("autoBizUse")} testID="f-autoBizUse">My insurer confirmed business use is covered, and the declarations page I upload shows it.</Attest> : null}
              {form.autoType ? <Policy prefix="auto" a={a}>{up("auto", "Declarations page or certificate")}</Policy> : null}
            </Section>
          ) : null}

          {cov ? (
            <Section title="Workers' compensation">
              {employees === "5+" ? (
                <>
                  <Text style={muted}>Tennessee requires workers' compensation for employers with 5 or more employees.</Text>
                  <DateInput form={form} set={set} k="wcExpires" err={err} label="Expiration date" />
                  {up("wc", "Workers' comp certificate")}
                </>
              ) : (
                <>
                  <Text style={muted}>Tennessee requires coverage once you have 5 or more employees. Partner Protection doesn't cover your own injuries.</Text>
                  <Attest value={form.wcAck} onChange={set("wcAck")} testID="f-wcAck">I'll get workers' compensation and upload it before I reach 5 employees.</Attest>
                </>
              )}
            </Section>
          ) : null}
        </>
      ) : null}
    </StepScreen>
  );
}
