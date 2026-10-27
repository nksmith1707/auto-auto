// Background check: the federal disclosure on its own screen first, then the signed authorization.
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Button } from "../../../../shared/ui";
import { Attest, DocText, Section, SignBox, StepScreen, body, muted, useApplication } from "../../components/Onboarding";

const BG = { not_started: "Not started", pending: "In progress. We'll let you know when it's done.", clear: "Clear", consider: "Under review by our team", adverse: "Not approved. Check your email for next steps." };

export default function Background() {
  const a = useApplication("background");
  const { app, err, busy, call } = a;
  const [docs, setDocs] = useState({});
  useEffect(() => {
    for (const id of ["bg_disclosure", "bg_auth"]) call("onboardingDoc", id).then((r) => setDocs((d) => ({ ...d, [id]: r.document }))).catch(() => {});
  }, [call]);
  const read = !!(app && app.signatures.bg_disclosure);
  return (
    <StepScreen title="Background check" app={app} step={a.step} err={err}>
      {app ? (
        !read ? (
          <>
            <Text style={muted}>Federal law requires this notice to stand on its own. Read it, then continue to the authorization.</Text>
            <Section><DocText doc={docs.bg_disclosure} /></Section>
            {!app.locked ? <Button title="I've read this disclosure" onPress={() => a.sign("bg_disclosure")} loading={busy === "sign-bg_disclosure"} testID="ack-disclosure" /> : null}
          </>
        ) : (
          <>
            <Section><DocText doc={docs.bg_auth} /></Section>
            <Section>
              <Attest value={(app.answers.background || {}).copyRequested} onChange={(v) => a.save({ copyRequested: v })} testID="f-copyRequested">Send me a free copy of any report Auto-Auto receives.</Attest>
              <SignBox docId="bg_auth" app={app} locked={app.locked} busy={busy === "sign-bg_auth"} err={err} onSign={a.sign} buttonTitle="I authorize the background check" />
            </Section>
            {app.signatures.bg_auth ? <Section title="Status"><Text style={body} testID="bg-status">{BG[app.background.status]}</Text></Section> : null}
          </>
        )
      ) : null}
    </StepScreen>
  );
}

