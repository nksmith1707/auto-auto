// Review & submit: every step's status, the final certification, and Submit.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Notice } from "../../../../shared/ui";
import { Attest, Section, StepScreen, body, card, muted, useApplication } from "../../components/Onboarding";
import { stepRoute } from "../../components/steps";
import { fonts, p } from "../../theme";

export default function Review() {
  const router = useRouter();
  const a = useApplication(null);
  const { app, err, busy, call } = a;
  const [certify, setCertify] = useState(false);
  const submitted = app && app.status !== "applicant";
  return (
    <StepScreen title="Review & submit" app={app} err={err}>
      {app ? (
        <>
          <View style={[card, { padding: 0, gap: 0, overflow: "hidden" }]}>
            {app.steps.map((s, i) => (
              <Pressable key={s.id} onPress={() => router.push(stepRoute(s.id))} accessibilityRole="button" testID={`review-${s.id}`}
                style={({ pressed }) => ({ flexDirection: "row", gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, backgroundColor: pressed ? p.panel2 : "transparent" })}>
                <Text style={{ fontFamily: fonts.bodyX, fontSize: 15, color: s.done ? p.ok : p.money, width: 18 }}>{s.done ? "✓" : "!"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[body, { fontFamily: fonts.bodyB }]}>{s.title}</Text>
                  <Text style={muted}>{s.done ? "Complete" : `${s.errors[0]}${s.errors.length > 1 ? ` (+${s.errors.length - 1} more)` : ""}`}</Text>
                </View>
                <Text style={{ color: p.muted, fontSize: 18 }}>›</Text>
              </Pressable>
            ))}
          </View>
          {submitted ? <Notice>Your application was submitted. We'll let you know as soon as there's a decision.</Notice> : (
            <Section>
              <Attest value={certify} onChange={setCertify} testID="f-certify">Everything in this application is true and complete. I understand false or missing information is grounds for denial or removal from the platform.</Attest>
              <Button title="Submit application" variant="okb" disabled={!app.ready || !certify} loading={busy === "submit"} testID="submit-application"
                onPress={async () => { const s = await a.run("submit", () => call("submitApplication", true)); if (s) router.replace("/home"); }} />
              {!app.ready ? <Text style={muted}>Finish every step above to submit.</Text> : null}
            </Section>
          )}
        </>
      ) : null}
    </StepScreen>
  );
}
