// Add or edit a saved place (where partners meet you). The street address stays private until a booked partner starts driving.
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Button, Checkbox, Chips, ConfirmRemove, Field, Notice, Screen, T, errorParts, useTheme, dropFieldError } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

const LABELS = ["Home", "Work"];
const PARKING = [["driveway", "Driveway"], ["street", "Street"], ["lot", "Parking lot"], ["garage", "Garage"], ["other", "Other"]];
const EMPTY = { label: "Home", street: "", unit: "", city: "Knoxville", state: "TN", zip: "", parking: "driveway", notes: "", isDefault: false };

export default function PlaceScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const editing = typeof id === "string" && id;
  const { call } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [other, setOther] = useState(false);
  const [wasDefault, setWasDefault] = useState(false);
  const [loading, setLoading] = useState(!!editing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErr(dropFieldError(k)); };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  useEffect(() => {
    if (!editing) return;
    call("places").then(({ places }) => {
      const p = places.find((x) => x.id === id);
      if (!p) { setErr({ message: "That place isn't on your account anymore." }); setLoading(false); return; }
      setForm({ label: p.label, street: p.street, unit: p.unit || "", city: p.city, state: p.state, zip: p.zip, parking: p.parking, notes: p.notes || "", isDefault: p.isDefault });
      setOther(!LABELS.includes(p.label));
      setWasDefault(p.isDefault);
      setLoading(false);
    }).catch((e) => { setErr(e); setLoading(false); });
  }, [editing, id, call]);

  async function save() {
    setErr(null);
    const f = {};
    if (!form.label.trim()) f.label = "Give this place a name, like Mom's house.";
    if (!form.street.trim()) f.street = "Enter the street address.";
    if (!form.city.trim()) f.city = "Enter the city.";
    if (!/^\d{5}$/.test(form.zip.trim())) f.zip = "Enter a 5-digit ZIP code.";
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    try {
      if (editing) await call("updatePlace", id, form);
      else await call("addPlace", form);
      back();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  if (loading) return <Screen><TopBar onBack={back} /><ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} /></Screen>;

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 16 }}>
        <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>{editing ? "Edit place" : "Add a place"}</T>
        <Notice>Partners only see your general area so the app can match you with shops that travel to you. Your exact address goes to the one partner you book, and only when they start driving to the job.</Notice>

        <Chips label="Name" value={other ? "Other" : form.label} options={[...LABELS, "Other"].map((l) => [l, l])}
          onChange={(v) => { if (v === "Other") { setOther(true); set("label")(LABELS.includes(form.label) ? "" : form.label); } else { setOther(false); set("label")(v); } }}
          error={!other ? fields.label : null} testID="p-label-chips" />
        {other ? <Field label="Place name" value={form.label} onChangeText={set("label")} error={fields.label} placeholder="Mom's house" autoCapitalize="words" maxLength={30} testID="p-label" /> : null}

        <Field label="Street address" value={form.street} onChangeText={set("street")} error={fields.street} placeholder="123 Kingston Pike" autoComplete="street-address" textContentType="streetAddressLine1" testID="p-street" />
        <Field label="Apartment or unit (optional)" value={form.unit} onChangeText={set("unit")} error={fields.unit} placeholder="Apt 4B" textContentType="streetAddressLine2" testID="p-unit" />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1.6 }} label="City" value={form.city} onChangeText={set("city")} error={fields.city} autoCapitalize="words" textContentType="addressCity" testID="p-city" />
          <Field style={{ width: 64 }} label="State" value={form.state} onChangeText={(v) => set("state")(v.toUpperCase())} error={fields.state} maxLength={2} autoCapitalize="characters" textContentType="addressState" testID="p-state" />
          <Field style={{ flex: 1 }} label="ZIP code" value={form.zip} onChangeText={set("zip")} error={fields.zip} keyboardType="number-pad" maxLength={5} textContentType="postalCode" testID="p-zip" />
        </View>
        <Chips label="Where will the vehicle be?" value={form.parking} onChange={set("parking")} options={PARKING} error={fields.parking} />
        <Field label="Notes for your partner (optional)" value={form.notes} onChangeText={set("notes")} error={fields.notes}
          placeholder="Gate code, which spot, where to find the keys" multiline numberOfLines={3} style={{}} maxLength={300} testID="p-notes" />
        {!wasDefault ? <Checkbox checked={form.isDefault} onChange={set("isDefault")}>Use this place by default when I book</Checkbox> : <T v="hint">This is your default place.</T>}

        {message ? <Notice tone="bad">{message}</Notice> : null}
        <Button title={editing ? "Save changes" : "Save place"} onPress={save} loading={busy} testID="p-save" />
        {editing ? (
          <ConfirmRemove label="Remove this place" question="Remove this saved place?" onConfirm={async () => { await call("removePlace", id); back(); }} testID="p-remove" />
        ) : null}
      </View>
    </Screen>
  );
}
