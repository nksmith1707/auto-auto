// Agreements: open each one, read it, and sign with your legal name.
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "../../../../shared/ui";
import { Section, StepScreen, body, card, muted, useApplication } from "../../components/Onboarding";
import { fonts, p } from "../../theme";

export default function Agreements() {
  const router = useRouter();
  const a = useApplication("agreements");
  const { app, err, busy, call } = a;
  const legal = app ? [app.legalName.first, app.legalName.middle, app.legalName.last].filter(Boolean).join(" ") : "";
  const arb = app && app.arbitration;
  return (
    <StepScreen title="Agreements" app={app} step={a.step} err={err}>
      {app ? (
        <>
          <Text style={body}>Open each agreement, read to the end, and sign with your legal name: <Text style={{ fontFamily: fonts.bodyB }}>{legal || "(add it in Business & tax)"}</Text></Text>
          <View style={[card, { padding: 0, gap: 0, overflow: "hidden" }]}>
            {app.agreements.map((g, i) => (
              <Pressable key={g.id} onPress={() => router.push({ pathname: "/onboarding/document", params: { id: g.id } })} accessibilityRole="button" testID={`agreement-${g.id}`}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, backgroundColor: pressed ? p.panel2 : "transparent" })}>
                <View style={{ flex: 1 }}>
                  <Text style={[body, { fontFamily: fonts.bodyB }]}>{g.title}</Text>
                  <Text style={muted}>{g.signed ? `Signed ${new Date(app.signatures[g.id].signedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}` : "Not signed"}</Text>
                </View>
                <Text style={{ fontFamily: fonts.bodyX, fontSize: 11, color: g.signed ? p.ok : p.money }}>{g.signed ? "SIGNED" : "OPEN ›"}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[muted, { fontSize: 12 }]}>Drafts for attorney review. Each signature records your typed name, the time, and the exact document version.</Text>
          {arb && (arb.optedOutAt || arb.canOptOutUntil) ? (
            <Section title="Arbitration">
              {arb.optedOutAt ? <Text style={muted}>You opted out of arbitration on {new Date(arb.optedOutAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.</Text> : (
                <>
                  <Text style={muted}>You can opt out of arbitration until {new Date(arb.canOptOutUntil).toLocaleDateString("en-US", { dateStyle: "medium" })}. It doesn't affect anything else about your account.</Text>
                  <Button title="Opt out of arbitration" variant="ghost" onPress={() => a.run("optout", () => call("optOutArbitration"))} loading={busy === "optout"} />
                </>
              )}
            </Section>
          ) : null}
        </>
      ) : null}
    </StepScreen>
  );
}
