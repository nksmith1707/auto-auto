// Read one agreement and sign it with your typed legal name.
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DocText, Section, SignBox, StepScreen, muted, useApplication } from "../../components/Onboarding";

export default function DocumentScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const a = useApplication(null);
  const { app, err, busy, call } = a;
  const [doc, setDoc] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  useEffect(() => { call("onboardingDoc", String(id)).then((r) => setDoc(r.document)).catch((e) => setLoadErr(e)); }, [call, id]);
  async function sign(docId, name) {
    const s = await a.sign(docId, name);
    if (s && router.canGoBack()) router.back();
  }
  return (
    <StepScreen title={doc ? doc.title : "Agreement"} app={app} err={err || loadErr}>
      {app ? (
        <>
          <Section><DocText doc={doc} /></Section>
          <Section>
            {app.signatures[id] ? null : <Text style={muted}>By signing, you agree to this document. Your typed name, the time, and this version are recorded.</Text>}
            {doc ? <SignBox docId={String(id)} app={app} locked={app.locked} busy={busy === `sign-${id}`} err={err} onSign={sign} buttonTitle="I agree and sign" /> : null}
          </Section>
        </>
      ) : null}
    </StepScreen>
  );
}
