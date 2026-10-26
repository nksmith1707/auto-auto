// Add or edit a vehicle. Matches the vehicle card in the prototype's "Let's Get Started" page.
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Button, Chips, ConfirmRemove, Field, Notice, Screen, T, errorParts, useTheme, dropFieldError } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

const FUELS = [["gas", "Gas"], ["diesel", "Diesel"], ["hybrid", "Hybrid"], ["electric", "Electric"]];
const OILS = ["Full synthetic 0W-20", "Full synthetic 5W-20", "Full synthetic 5W-30", "Synthetic blend", "Conventional", "High mileage", "Diesel 15W-40", "Not sure"];
const EMPTY = { vin: "", year: "", make: "", model: "", trim: "", plate: "", plateState: "TN", color: "", mileage: "", fuel: "gas", oilPreference: null, insurer: "", policyNumber: "" };
const str = (v) => (v == null ? "" : String(v));

export default function VehicleScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const editing = typeof id === "string" && id;
  const { call } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(!!editing);
  const [busy, setBusy] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [vinMsg, setVinMsg] = useState(null);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErr(dropFieldError(k)); };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  useEffect(() => {
    if (!editing) return;
    call("vehicle", id).then(({ vehicle: v }) => {
      setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "fuel" || k === "oilPreference" ? x : str(x)])) });
      setLoading(false);
    }).catch((e) => { setErr(e); setLoading(false); });
  }, [editing, id, call]);

  async function decode() {
    setErr(null);
    setVinMsg(null);
    if (!form.vin.trim()) return setErr({ code: "invalid_input", fields: { vin: "Enter the VIN first." } });
    setDecoding(true);
    try {
      const { vin: d, message } = await call("decodeVin", form.vin);
      setForm((f) => ({
        ...f, vin: d.vin,
        year: d.year ? String(d.year) : f.year, make: d.make || f.make, model: d.model || f.model,
        trim: d.trim || f.trim, fuel: d.fuel || f.fuel,
      }));
      setVinMsg({ tone: d.checkDigitOk ? (d.model ? "ok" : "info") : "bad", text: message + (d.engine ? ` Engine: ${d.engine}.` : "") });
    } catch (e) {
      setErr(e);
    } finally {
      setDecoding(false);
    }
  }

  async function save() {
    setErr(null);
    const f = {};
    if (!form.year.trim()) f.year = "Enter the model year.";
    if (!form.make.trim()) f.make = "Enter the make.";
    if (!form.model.trim()) f.model = "Enter the model.";
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    const body = {
      year: form.year.trim(), make: form.make, model: form.model, trim: form.trim, vin: form.vin.trim() || null,
      plate: form.plate, plateState: form.plateState || null, color: form.color, mileage: form.mileage.trim() || null,
      fuel: form.fuel, oilPreference: form.oilPreference, insurer: form.insurer, policyNumber: form.policyNumber,
    };
    try {
      if (editing) await call("updateVehicle", id, body);
      else await call("addVehicle", body);
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
        <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>{editing ? "Edit vehicle" : "Add a vehicle"}</T>
        <T v="muted" style={{ textAlign: "center" }}>Partners see your vehicle so they bring the right parts. Your plate and insurance stay private.</T>

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <Field style={{ flex: 1 }} label="VIN number" value={form.vin} onChangeText={(v) => { set("vin")(v.toUpperCase()); setVinMsg(null); }} error={fields.vin}
              placeholder="17 characters" autoCapitalize="characters" maxLength={20} testID="v-vin" />
            {!fields.vin ? <Button title="Decode" variant="ghost" onPress={decode} loading={decoding} style={{ minWidth: 96, marginBottom: 0 }} testID="v-decode" /> : null}
          </View>
          {fields.vin ? <Button title="Decode" variant="ghost" onPress={decode} loading={decoding} testID="v-decode" /> : null}
          {vinMsg ? <Notice tone={vinMsg.tone}>{vinMsg.text}</Notice> : <T v="hint">Fills in the year, make, and model. It's on the windshield or the driver's door jamb.</T>}
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ width: 96 }} label="Year" value={form.year} onChangeText={set("year")} error={fields.year} keyboardType="number-pad" maxLength={4} placeholder="2018" testID="v-year" />
          <Field style={{ flex: 1 }} label="Make" value={form.make} onChangeText={set("make")} error={fields.make} placeholder="Honda" autoCapitalize="words" testID="v-make" />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1.4 }} label="Model" value={form.model} onChangeText={set("model")} error={fields.model} placeholder="Civic" autoCapitalize="words" testID="v-model" />
          <Field style={{ flex: 1 }} label="Trim (optional)" value={form.trim} onChangeText={set("trim")} error={fields.trim} placeholder="EX" autoCapitalize="characters" testID="v-trim" />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1.4 }} label="License plate" value={form.plate} onChangeText={(v) => set("plate")(v.toUpperCase())} error={fields.plate} autoCapitalize="characters" placeholder="ABC-1234" testID="v-plate" />
          <Field style={{ flex: 1 }} label="State" value={form.plateState} onChangeText={(v) => set("plateState")(v.toUpperCase())} error={fields.plateState} autoCapitalize="characters" maxLength={2} placeholder="TN" testID="v-plate-state" />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1 }} label="Mileage" value={form.mileage} onChangeText={set("mileage")} error={fields.mileage} keyboardType="number-pad" placeholder="84,000" testID="v-mileage" />
          <Field style={{ flex: 1 }} label="Color (optional)" value={form.color} onChangeText={set("color")} error={fields.color} placeholder="White" autoCapitalize="words" testID="v-color" />
        </View>
        <Chips label="Fuel type" value={form.fuel} onChange={set("fuel")} options={FUELS} error={fields.fuel} testID="v-fuel" />
        {form.fuel !== "electric" ? (
          <Chips label="Oil preference (optional)" value={form.oilPreference} onChange={set("oilPreference")} options={OILS.map((o) => [o, o])} error={fields.oilPreference} allowNone />
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1 }} label="Insurance company" value={form.insurer} onChangeText={set("insurer")} error={fields.insurer} placeholder="Optional" autoCapitalize="words" />
          <Field style={{ flex: 1 }} label="Policy number" value={form.policyNumber} onChangeText={set("policyNumber")} error={fields.policyNumber} placeholder="Optional" autoCapitalize="characters" />
        </View>

        {message ? <Notice tone="bad">{message}</Notice> : null}
        <Button title={editing ? "Save changes" : "Add vehicle"} onPress={save} loading={busy} testID="v-save" />
        {editing ? (
          <ConfirmRemove label="Remove this vehicle" question="Remove this vehicle? Its service history stays on file."
            onConfirm={async () => { await call("removeVehicle", id); back(); }} testID="v-remove" />
        ) : null}
      </View>
    </Screen>
  );
}
