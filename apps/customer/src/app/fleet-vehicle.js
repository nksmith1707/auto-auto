// Add a vehicle to the business account.
import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Button, Chips, Field, Notice, Screen, T, errorParts } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";

const CLASSES = [["van_pickup", "Van or pickup"], ["box_truck", "Box truck"], ["tractor", "Tractor"], ["trailer", "Trailer"]];

export default function FleetVehicle() {
  const router = useRouter();
  const { call } = useAuth();
  const [f, setF] = useState({ unit: "", year: "", make: "", model: "", vehicleClass: "van_pickup", plate: "", vin: "", mileage: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/fleet"));
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => (e && e.fields && e.fields[k] ? { ...e, fields: { ...e.fields, [k]: undefined } } : e)); };
  const { message, fields } = errorParts(err);
  async function save() {
    setBusy(true); setErr(null);
    try { await call("addFleetVehicle", { ...f, year: Number(f.year), mileage: f.mileage || null, vin: f.vin || null, plate: f.plate || null }); back(); }
    catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 14 }}>
        <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>Add a vehicle</T>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1 }} label="Unit #" value={f.unit} onChangeText={set("unit")} error={fields.unit} placeholder="Unit 121" testID="fv-unit" />
          <Field style={{ flex: 1 }} label="Plate (optional)" value={f.plate} onChangeText={set("plate")} error={fields.plate} autoCapitalize="characters" testID="fv-plate" />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1 }} label="Year" value={f.year} onChangeText={set("year")} error={fields.year} keyboardType="number-pad" maxLength={4} testID="fv-year" />
          <Field style={{ flex: 1.5 }} label="Make" value={f.make} onChangeText={set("make")} error={fields.make} placeholder="Ford" testID="fv-make" />
        </View>
        <Field label="Model" value={f.model} onChangeText={set("model")} error={fields.model} placeholder="Transit 250" testID="fv-model" />
        <Chips label="Type" value={f.vehicleClass} onChange={set("vehicleClass")} options={CLASSES} error={fields.vehicleClass} testID="fv-class" />
        <T v="hint">Bigger vehicles take longer and need bigger parts. Services that don't fit a type (like an oil change on a trailer) are skipped.</T>
        <Field label="Current mileage (optional for trailers)" value={f.mileage} onChangeText={set("mileage")} error={fields.mileage} keyboardType="number-pad" placeholder="45,000" testID="fv-miles" />
        <Field label="VIN (optional)" value={f.vin} onChangeText={set("vin")} error={fields.vin} autoCapitalize="characters" maxLength={17} />
        {message ? <Notice tone="bad">{message}</Notice> : null}
        <Button title="Add vehicle" onPress={save} loading={busy} testID="fv-save" />
      </View>
    </Screen>
  );
}
