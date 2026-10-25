// Forgot password and enter-the-code screens. Same steps in both apps; each app supplies the header and theme.
import { useRef, useState } from "react";
import { View } from "react-native";
import { useAuth } from "./session";
import { passwordHint } from "./api";
import { Button, Field, LinkButton, Notice, T, errorParts } from "./ui";

export function ForgotPasswordForm({ initialEmail = "", onSent, onBack }) {
  const { requestReset } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    if (!email.trim()) return setErr({ fields: { email: "Enter your email." } });
    setBusy(true);
    try {
      await requestReset(email.trim());
      onSent(email.trim());
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <View style={{ gap: 16 }}>
      <T v="h1">Reset your password</T>
      <T v="muted">Enter the email on your account. We'll send a code you can use to pick a new password.</T>
      <Field label="Email" value={email} onChangeText={setEmail} error={fields.email} placeholder="you@email.com"
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress"
        returnKeyType="send" onSubmitEditing={submit} testID="forgot-email" />
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Button title="Send reset code" onPress={submit} loading={busy} big testID="forgot-submit" />
      <LinkButton title="Back to log in" onPress={onBack} style={{ alignSelf: "center" }} />
    </View>
  );
}

export function ResetPasswordForm({ email, onDone, onResend, onBack }) {
  const { confirmReset, requestReset } = useAuth();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [resent, setResent] = useState(false);
  const pwRef = useRef(null);

  async function submit() {
    setErr(null);
    const f = {};
    if (!code.trim()) f.token = "Enter the reset code from your email.";
    const p = passwordHint(password, email);
    if (p) f.password = p;
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    try {
      await confirmReset({ token: code.trim(), password });
      onDone();
    } catch (e) {
      setErr(e.code === "reset_invalid" ? { ...e, fields: { token: e.message } , code: "invalid_input" } : e);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null);
    try {
      await requestReset(email);
      setResent(true);
      onResend && onResend();
    } catch (e) {
      setErr(e);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <View style={{ gap: 16 }}>
      <T v="h1">Check your email</T>
      <T v="muted">If there's an account for {email || "that email"}, we sent a reset code. It works once and expires in 30 minutes.</T>
      {resent ? <Notice tone="ok">We sent a new code. Use the newest one.</Notice> : null}
      <Field label="Reset code" value={code} onChangeText={setCode} error={fields.token} placeholder="Paste the code from the email"
        autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" returnKeyType="next"
        onSubmitEditing={() => pwRef.current && pwRef.current.focus()} testID="reset-code" />
      <Field ref={pwRef} label="New password" value={password} onChangeText={setPassword} error={fields.password}
        hint="At least 10 characters" placeholder="At least 10 characters" secure autoCapitalize="none"
        autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={submit} testID="reset-password" />
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Button title="Save new password" onPress={submit} loading={busy} big testID="reset-submit" />
      <T v="hint" style={{ textAlign: "center" }}>Changing your password signs you out on every device.</T>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 20 }}>
        <LinkButton title="Send a new code" onPress={resend} />
        <LinkButton title="Back to log in" onPress={onBack} />
      </View>
    </View>
  );
}
