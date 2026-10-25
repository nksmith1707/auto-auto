// Log in / Sign up, from the customer prototype's first screen.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EngineLogo } from "../../../shared/Logo";
import { useAuth } from "../../../shared/session";
import { passwordHint } from "../../../shared/api";
import { Button, Checkbox, Field, LinkButton, Notice, Screen, T, Tabs, errorParts, useTheme } from "../../../shared/ui";

export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { signIn, signUp } = useAuth();
  const [tab, setTab] = useState(params.tab === "signup" ? "signup" : "login");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", terms: false });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(params.notice === "reset" ? "Your password is changed. Log in with your new password." : null);
  useEffect(() => {
    if (params.notice === "reset") { setTab("login"); setErr(null); setNotice("Your password is changed. Log in with your new password."); }
  }, [params.notice]);
  const refs = { lastName: useRef(null), email: useRef(null), phone: useRef(null), password: useRef(null) };
  const login = tab === "login";
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const next = (k) => () => refs[k].current && refs[k].current.focus();

  function switchTab(k) { setTab(k); setErr(null); setNotice(null); }

  async function submit() {
    setErr(null);
    setNotice(null);
    const f = {};
    if (!form.email.trim()) f.email = "Enter your email.";
    if (login) {
      if (!form.password) f.password = "Enter your password.";
    } else {
      if (!form.firstName.trim()) f.firstName = "Enter your first name.";
      if (!form.lastName.trim()) f.lastName = "Enter your last name.";
      const p = passwordHint(form.password, form.email);
      if (p) f.password = p;
      if (!form.terms) f.acceptTerms = "Agree to the Terms of Service and Privacy Policy to continue.";
    }
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    try {
      if (login) await signIn({ email: form.email.trim(), password: form.password });
      else await signUp({
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
        phone: form.phone.trim() || undefined, password: form.password, acceptTerms: true,
      });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <Screen contentStyle={{ paddingTop: 40, paddingBottom: 24 }}>
      <View style={{ gap: 18 }}>
        <View style={{ alignItems: "center" }}>
          <EngineLogo size={70} color={t.c.logo} hole={t.c.logoHole} />
          <T style={{ fontFamily: t.f.displayX, fontSize: 26, letterSpacing: 1.56, textTransform: "uppercase", color: t.c.logo }}>Auto Auto</T>
        </View>
        <T v="h1" accessibilityRole="header">{login ? "Welcome back" : "Create your account"}</T>
        <Tabs value={tab} onChange={switchTab} options={[["login", "Log in"], ["signup", "Sign up"]]} />
        {notice ? <Notice tone="ok">{notice}</Notice> : null}

        <View style={{ gap: 14 }}>
          {!login ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field style={{ flex: 1 }} label="First name" value={form.firstName} onChangeText={set("firstName")} error={fields.firstName}
                placeholder="Jordan" autoComplete="given-name" textContentType="givenName" autoCapitalize="words"
                returnKeyType="next" onSubmitEditing={next("lastName")} testID="first-name" />
              <Field ref={refs.lastName} style={{ flex: 1 }} label="Last name" value={form.lastName} onChangeText={set("lastName")} error={fields.lastName}
                placeholder="Reese" autoComplete="family-name" textContentType="familyName" autoCapitalize="words"
                returnKeyType="next" onSubmitEditing={next("email")} testID="last-name" />
            </View>
          ) : null}
          <Field ref={refs.email} label="Email" value={form.email} onChangeText={set("email")} error={fields.email} placeholder="you@email.com"
            keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType={login ? "username" : "emailAddress"}
            returnKeyType="next" onSubmitEditing={next(login ? "password" : "phone")} testID="email" />
          {!login ? (
            <Field ref={refs.phone} label="Mobile phone (optional)" value={form.phone} onChangeText={set("phone")} error={fields.phone}
              placeholder="(865) 555-0100" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
              hint="For texts about your service. Partners never see your real number." returnKeyType="next" onSubmitEditing={next("password")} testID="phone" />
          ) : null}
          <Field ref={refs.password} label="Password" value={form.password} onChangeText={set("password")} error={fields.password}
            placeholder={login ? "Your password" : "At least 10 characters"} secure autoCapitalize="none"
            autoComplete={login ? "current-password" : "new-password"} textContentType={login ? "password" : "newPassword"}
            returnKeyType={login ? "go" : "next"} onSubmitEditing={login ? submit : undefined} testID="password" />
          {!login ? (
            <Checkbox checked={form.terms} onChange={set("terms")} error={fields.acceptTerms}>
              I agree to the Auto-Auto Terms of Service and Privacy Policy.
            </Checkbox>
          ) : null}
          {message ? <Notice tone="bad">{message}</Notice> : null}
          <Button title={login ? "Log in" : "Create account"} onPress={submit} loading={busy} testID="auth-submit" />
          {login ? (
            <LinkButton title="Forgot password?" style={{ alignSelf: "center" }}
              onPress={() => router.push({ pathname: "/forgot-password", params: { email: form.email.trim() } })} />
          ) : null}
          <T v="hint" style={{ textAlign: "center" }}>
            {login ? "New here? Tap Sign up to set up your profile and vehicles." : "Next you'll add your vehicles and where we should meet you."}
          </T>
        </View>
      </View>
    </Screen>
  );
}
