// Safety standards: the minimum every partner meets. Auto-Auto doesn't tell partners which tools or brands to use.
import { Text } from "react-native";
import { Attest, Input, Section, StepScreen, muted, useApplication } from "../../components/Onboarding";

const ITEMS = [
  ["lift", "I never work under a vehicle held only by a jack. I use stands or a lift rated for the vehicle, on firm level ground, with wheels chocked."],
  ["spill", "I use drip pans and carry a spill kit and absorbent on every job."],
  ["fire", "I carry a working fire extinguisher (rated B:C or better) in my service vehicle."],
  ["usedOil", "I store used oil in closed containers labeled \"Used Oil\" and take it to a used-oil collection center, no more than 55 gallons per trip."],
  ["filters", "I hot-drain used oil filters before disposal and keep drained oil with my used oil."],
  ["noStreet", "Except for roadside help, I don't do service work on a public street or highway shoulder."],
  ["sober", "I don't use drugs or drink before or during jobs."],
];

export default function Safety() {
  const a = useApplication("safety");
  const { app, form, set, err, busy } = a;
  return (
    <StepScreen title="Safety standards" app={app} step={a.step} err={err} onSave={() => a.save()} saving={busy === "save"}>
      {app ? (
        <>
          <Text style={muted}>Auto-Auto doesn't tell you which tools or brands to use. These are the minimum safety standards every partner meets.</Text>
          <Section>
            {ITEMS.map(([k, t]) => <Attest key={k} value={form[k]} onChange={set(k)} testID={`f-${k}`}>{t}</Attest>)}
          </Section>
          <Section>
            <Input form={form} set={set} k="usedOilSite" err={err} label="Where you take used oil" placeholder="e.g. AutoZone on Kingston Pike, or a city collection center" />
          </Section>
        </>
      ) : null}
    </StepScreen>
  );
}
