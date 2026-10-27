// Experience & certifications: experience, where you work, and proof for the services that need it.
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "../../../../shared/ui";
import { Attest, Input, Pick, Section, StepScreen, Upload, muted, useApplication } from "../../components/Onboarding";

const has = (app, ids) => ids.some((x) => app.servicesOffered.includes(x));

export default function Skills() {
  const router = useRouter();
  const a = useApplication("skills");
  const { app, form, set, err, busy } = a;
  const up = (kind, title, hint) => <Upload kind={kind} title={title} hint={hint} app={app} locked={app.locked} onUploaded={a.setApp} />;
  return (
    <StepScreen title="Experience & certifications" app={app} step={a.step} err={err} onSave={() => a.save()} saving={busy === "save"} saved={a.saved}>
      {app ? (
        <>
          <Section title="Experience">
            <Pick label="Hands-on experience" value={form.experience} onChange={set("experience")} testID="f-experience" options={[["0", "Under 2 years"], ["2", "2–4 years"], ["5", "5–9 years"], ["10", "10+ years"]]} />
            {form.experience === "0" ? <Text style={muted}>With under 2 years, upload an ASE certificate below.</Text> : null}
            <Pick label="Where you work" value={form.setting} onChange={set("setting")} testID="f-setting" options={[["mobile", "At the customer's location"], ["shop", "My shop"], ["both", "Both"]]} />
          </Section>

          {form.setting === "shop" || form.setting === "both" ? (
            <Section title="Your shop">
              <Input form={form} set={set} k="shopStreet" err={err} label="Street address" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Input form={form} set={set} k="shopCity" err={err} label="City" style={{ flex: 2 }} />
                <Input form={form} set={set} k="shopState" err={err} label="State" style={{ flex: 1 }} autoCapitalize="characters" maxLength={2} placeholder="TN" />
                <Input form={form} set={set} k="shopZip" err={err} label="ZIP" style={{ flex: 1.3 }} keyboardType="number-pad" maxLength={5} />
              </View>
              {up("buslic", "Business license for the shop", "City or county business license")}
            </Section>
          ) : null}

          <Section title="Proof for your services">
            <Text style={muted}>Some services need proof on file. This list follows the services you turned on.</Text>
            <Button title="Change services" variant="ghost" onPress={() => router.push("/services")} />
            {has(app, ["brakes", "dot_brake"]) || form.experience === "0"
              ? up("ase", "ASE certificate (A5 brakes) or proof of brake work", "Required for brake work. A reference letter or past work record also works.") : null}
            {!has(app, ["brakes", "dot_brake"]) && app.servicesOffered.includes("diagnostics") ? (
              <>
                {up("ase", "ASE certificate (A6/A8)", "Optional if you confirm experience below")}
                <Attest value={form.brakeExperience} onChange={set("brakeExperience")} testID="f-brakeExperience">I have 2+ years of paid diagnostic work, and I'll provide references if asked.</Attest>
              </>
            ) : null}
            {app.servicesOffered.includes("ac_service") ? (
              <>
                <Input form={form} set={set} k="epa609Number" err={err} label="EPA Section 609 certificate number" hint="Federal law requires it for paid A/C work." />
                {up("epa609", "EPA Section 609 certificate")}
                <Attest value={form.acEquipment} onChange={set("acEquipment")} testID="f-acEquipment">I use EPA-approved refrigerant recovery equipment and never vent refrigerant.</Attest>
              </>
            ) : null}
            {has(app, ["glass_chip", "glass_windshield", "glass_side", "glass_back", "glass_adas"]) ? up("glass_cert", "Auto glass certification", "For example AGSC or manufacturer training") : null}
            {has(app, ["dot_annual", "dot_brake", "dot_dvir"]) ? up("dot_cert", "DOT inspector qualification", "Proof you're qualified to do DOT annual inspections (49 CFR 396.19)") : null}
            {has(app, ["exterior_wash", "full_detail", "fleet_wash"]) ? up("wash", "Water containment proof", "A photo of your water reclaim mat or containment system") : null}
            {app.servicesOffered.includes("lockout") ? <Attest value={form.lockoutId} onChange={set("lockoutId")} testID="f-lockoutId">Before unlocking, I'll check the customer's photo ID matches the account and the vehicle's registration or proof of ownership.</Attest> : null}
            {app.servicesOffered.includes("fuel_delivery") ? <Attest value={form.fuelCans} onChange={set("fuelCans")} testID="f-fuelCans">I carry fuel only in approved containers of 5 gallons or less, secured upright and away from the passenger area.</Attest> : null}
          </Section>
        </>
      ) : null}
    </StepScreen>
  );
}
