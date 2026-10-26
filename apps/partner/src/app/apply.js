// Apply to become a partner, step 1: the account. The rest of the application (business, ID, background check,
// agreements) comes in roadmap step 9; until then new partners land on their application status.
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { passwordHint } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Checkbox, Field, LinkButton, Notice, Screen, T, errorParts, dropFieldError } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

const MUST = [
  "Be 21 or older with a valid driver's license held 2+ years",
  "Have 2+ years of hands-on auto experience, or an ASE certification",
  "Pass a background check and driving record check",
  "Use your own tools and a smartphone",
];

export default function Apply() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", terms: false });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const refs = { lastName: useRef(null), email: useRef(null), phone: useRef(null), password: useRef(null) };
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErr(dropFieldError(k)); };
  const next = (k) => () => refs[k].current && refs[k].current.focus();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/sign-in"));

  async function submit() {
    setErr(null);
    const f = {};
    if (!form.firstName.trim()) f.firstName = "Enter your legal first name.";
    if (!form.lastName.trim()) f.lastName = "Enter your legal last name.";
    if (!form.email.trim()) f.email = "Enter your email.";
    if (!form.phone.trim()) f.phone = "Enter your mobile number.";
    const pw = passwordHint(form.password, form.email);
    if (pw) f.password = pw;
    if (!form.terms) f.acceptTerms = "Agree to the Terms of Service and Privacy Policy to continue.";
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    try {
      await signUp({
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
        phone: form.phone.trim(), password: form.password, acceptTerms: true,
      });
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 24 }}>
      <TopBar onBack={back} title="Partner application" />

      <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}>
          <T v="h1" accessibilityRole="header">Create your partner account</T>
          <T v="muted">Partners work on people's vehicles, often at their homes, so we check every partner carefully. Start with your account, then finish the rest of the application from the app.</T>
        </View>

        <View style={{ backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 16, padding: 14, gap: 8 }}>
          <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" }}>You must</Text>
          {MUST.map((m) => (
            <View key={m} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={{ color: p.money, fontFamily: fonts.bodyX }}>•</Text>
              <Text style={{ flex: 1, color: p.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{m}</Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field style={{ flex: 1 }} label="Legal first name" value={form.firstName} onChangeText={set("firstName")} error={fields.firstName}
              autoComplete="given-name" textContentType="givenName" autoCapitalize="words" returnKeyType="next" onSubmitEditing={next("lastName")} testID="first-name" />
            <Field ref={refs.lastName} style={{ flex: 1 }} label="Legal last name" value={form.lastName} onChangeText={set("lastName")} error={fields.lastName}
              autoComplete="family-name" textContentType="familyName" autoCapitalize="words" returnKeyType="next" onSubmitEditing={next("email")} testID="last-name" />
          </View>
          <Field ref={refs.email} label="Email" value={form.email} onChangeText={set("email")} error={fields.email} placeholder="you@email.com"
            keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={next("phone")} testID="email" />
          <Field ref={refs.phone} label="Mobile number" value={form.phone} onChangeText={set("phone")} error={fields.phone} placeholder="(865) 555-0100"
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" hint="For job alerts. Customers never see your real number."
            returnKeyType="next" onSubmitEditing={next("password")} testID="phone" />
          <Field ref={refs.password} label="Password" value={form.password} onChangeText={set("password")} error={fields.password}
            placeholder="At least 10 characters" hint="At least 10 characters" secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" testID="password" />
          <Checkbox checked={form.terms} onChange={set("terms")} error={fields.acceptTerms}>
            I agree to the Auto-Auto Terms of Service and Privacy Policy. Partner agreements come later in the application.
          </Checkbox>
          {message ? <Notice tone="bad">{message}</Notice> : null}
          <Button title="Create account" onPress={submit} loading={busy} big testID="apply-submit" />
          <LinkButton title="Already a partner? Log in" style={{ alignSelf: "center" }} onPress={back} />
        </View>
      </View>
    </Screen>
  );
}
