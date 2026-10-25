// Partner log in, from the partner prototype.
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EngineLogo } from "../../../shared/Logo";
import { useAuth } from "../../../shared/session";
import { Button, Field, LinkButton, Notice, Screen, T, errorParts } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { PartnerBadge } from "../components/PartnerBadge";
import { fonts, p } from "../theme";

const PERKS = [["4 hr", "max customer wait"], ["Weekly", "auto deposits"], ["You", "set your area"]];

export default function SignIn() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const pwRef = useRef(null);

  useEffect(() => {
    if (params.notice === "reset") { setErr(null); setNotice("Your password is changed. Log in with your new password."); }
  }, [params.notice]);

  async function submit() {
    setErr(null);
    setNotice(null);
    const f = {};
    if (!email.trim()) f.email = "Enter your email.";
    if (!password) f.password = "Enter your password.";
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    try {
      await signIn({ email: email.trim(), password });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingTop: 36, paddingBottom: 24 }}>
      <View style={{ flex: 1, gap: 18 }}>
        <View style={{ gap: 8, alignItems: "flex-start" }}>
          <EngineLogo size={64} color={p.brandText} accent={p.money} hole={p.navy} />
          <PartnerBadge small />
          <T v="h1" accessibilityRole="header">Welcome back to the road.</T>
          <T v="muted">Log in to see jobs near you and get paid for the work you already do.</T>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          {PERKS.map(([b, s]) => (
            <View key={b} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
              <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.ink }}>{b}</Text>
              <Text style={{ fontFamily: fonts.bodyB, fontSize: 12, color: p.muted }}>{s}</Text>
            </View>
          ))}
        </View>

        {notice ? <Notice tone="ok">{notice}</Notice> : null}
        <View style={{ gap: 14 }}>
          <Field label="Email" value={email} onChangeText={setEmail} error={fields.email} placeholder="you@email.com"
            keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username"
            returnKeyType="next" onSubmitEditing={() => pwRef.current && pwRef.current.focus()} testID="email" />
          <Field ref={pwRef} label="Password" value={password} onChangeText={setPassword} error={fields.password} placeholder="Your password"
            secure autoCapitalize="none" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} testID="password" />
          {message ? <Notice tone="bad">{message}</Notice> : null}
          <Button title="Log in" onPress={submit} loading={busy} big testID="auth-submit" />
          <LinkButton title="Forgot password?" style={{ alignSelf: "center" }}
            onPress={() => router.push({ pathname: "/forgot-password", params: { email: email.trim() } })} />
        </View>

        <View style={{ marginTop: "auto", paddingTop: 16, gap: 10, alignItems: "center" }}>
          <T style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>Not a partner yet?</T>
          <Button title="Apply to become a partner" variant="ghost" style={{ alignSelf: "stretch" }} onPress={() => router.push("/apply")} testID="go-apply" />
        </View>
      </View>
    </Screen>
  );
}
