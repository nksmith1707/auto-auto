// Home base and travel radius, from the partner prototype's "Service area" page.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../shared/session";
import { Button, Field, Notice, Screen, T, errorParts, dropFieldError } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

const LIMITS = { minMiles: 5, maxMiles: 60, stepMiles: 5 };

function RadiusPicker({ value, onChange, limits }) {
  const { minMiles: min, maxMiles: max, stepMiles: step } = limits;
  const presets = [10, 15, 25, 35, 50].filter((x) => x >= min && x <= max);
  const btn = (label, next, disabled, a11y) => (
    <Pressable onPress={() => !disabled && onChange(next)} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }}
      style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.panel2, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}>
      <Text style={{ fontFamily: fonts.displayX, fontSize: 26, color: p.ink }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" }}>Travel radius</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, padding: 14 }}
        accessibilityRole="adjustable" accessibilityValue={{ min, max, now: value, text: `${value} miles` }}>
        {btn("−", Math.max(min, value - step), value <= min, "Smaller radius")}
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontFamily: fonts.displayH, fontSize: 40, color: p.ink }} testID="radius-value">{value}</Text>
          <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.muted }}>miles</Text>
        </View>
        {btn("+", Math.min(max, value + step), value >= max, "Bigger radius")}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {presets.map((x) => (
          <Pressable key={x} onPress={() => onChange(x)} accessibilityRole="button" accessibilityLabel={`${x} miles`}
            style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, borderColor: x === value ? p.brand : p.line, backgroundColor: x === value ? p.brandSoft : "transparent" }}>
            <Text style={{ fontFamily: fonts.bodyX, fontSize: 13, color: x === value ? p.brandText : p.muted }}>{x}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[[`~${Math.round(value * 2.2)} min`, "longest drive"], [value >= 40 ? "Low" : value >= 20 ? "Good" : "High", "gas efficiency"]].map(([b, s]) => (
          <View key={s} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
            <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.ink }}>{b}</Text>
            <Text style={{ fontFamily: fonts.bodyB, fontSize: 12, color: p.muted }}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ServiceArea() {
  const router = useRouter();
  const { call, refresh } = useAuth();
  const [form, setForm] = useState({ street: "", city: "Knoxville", state: "TN", zip: "", radiusMiles: 15 });
  const [limits, setLimits] = useState(LIMITS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErr(dropFieldError(k)); };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  useEffect(() => {
    call("serviceArea").then(({ serviceArea: a, limits: l }) => {
      if (l) setLimits(l);
      if (a) setForm({ street: a.street, city: a.city, state: a.state, zip: a.zip, radiusMiles: a.radiusMiles });
      setLoading(false);
    }).catch((e) => { setErr(e); setLoading(false); });
  }, [call]);

  async function save() {
    setErr(null);
    const f = {};
    if (!form.street.trim()) f.street = "Enter your home base street address.";
    if (!form.city.trim()) f.city = "Enter the city.";
    if (!/^\d{5}$/.test(form.zip.trim())) f.zip = "Enter a 5-digit ZIP code.";
    if (Object.keys(f).length) return setErr({ code: "invalid_input", fields: f });
    setBusy(true);
    try {
      await call("saveServiceArea", form);
      await refresh().catch(() => {});
      back();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  const { message, fields } = errorParts(err);
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title="Service area" />
      {loading ? <ActivityIndicator color={p.brandText} style={{ marginTop: 40 }} /> : (
        <View style={{ gap: 18 }}>
          <View style={{ gap: 8 }}>
            <T v="h1" accessibilityRole="header">Where do you work?</T>
            <T v="muted">Customers outside your circle never see you, and you never get their requests. Go bigger for more jobs, smaller for less driving.</T>
          </View>
          <RadiusPicker value={form.radiusMiles} onChange={set("radiusMiles")} limits={limits} />
          <View style={{ gap: 14 }}>
            <Text style={{ fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" }}>Home base (center of your circle)</Text>
            <Field label="Street address" value={form.street} onChangeText={set("street")} error={fields.street} placeholder="45 Main St" textContentType="streetAddressLine1" testID="a-street" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field style={{ flex: 1.6 }} label="City" value={form.city} onChangeText={set("city")} error={fields.city} autoCapitalize="words" testID="a-city" />
              <Field style={{ width: 64 }} label="State" value={form.state} onChangeText={(v) => set("state")(v.toUpperCase())} error={fields.state} maxLength={2} autoCapitalize="characters" testID="a-state" />
              <Field style={{ flex: 1 }} label="ZIP" value={form.zip} onChangeText={set("zip")} error={fields.zip} keyboardType="number-pad" maxLength={5} testID="a-zip" />
            </View>
            <T v="hint">Private. Customers and other partners never see your address.</T>
          </View>
          {fields.radiusMiles ? <Notice tone="bad">{fields.radiusMiles}</Notice> : null}
          {message ? <Notice tone="bad">{message}</Notice> : null}
          <Button title="Save service area" onPress={save} loading={busy} big testID="a-save" />
        </View>
      )}
    </Screen>
  );
}
