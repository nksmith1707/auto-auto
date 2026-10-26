// Edit name and phone. Email changes go through support for now.
import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { formatPhone } from "../../../shared/api";
import { useAuth } from "../../../shared/session";
import { Button, Field, Notice, Screen, T, errorParts, dropFieldError } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

export default function Profile() {
  const router = useRouter();
  const { user, updateMe } = useAuth();
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ? formatPhone(user.phone) : "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErr(dropFieldError(k)); };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await updateMe({ firstName: form.firstName, lastName: form.lastName, phone: form.phone.trim() || null });
      back();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>Your details</T>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1 }} label="First name" value={form.firstName} onChangeText={set("firstName")} error={fields.firstName} autoCapitalize="words" testID="me-first" />
          <Field style={{ flex: 1 }} label="Last name" value={form.lastName} onChangeText={set("lastName")} error={fields.lastName} autoCapitalize="words" testID="me-last" />
        </View>
        <Field label="Mobile phone (optional)" value={form.phone} onChangeText={set("phone")} error={fields.phone} keyboardType="phone-pad"
          hint="For texts about your service. Partners never see your real number." testID="me-phone" />
        <Field label="Email" value={user.email} editable={false} hint="To change your email, contact support." />
        {message ? <Notice tone="bad">{message}</Notice> : null}
        <Button title="Save" onPress={save} loading={busy} testID="me-save" />
      </View>
    </Screen>
  );
}
