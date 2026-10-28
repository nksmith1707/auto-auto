// Pieces for after the visit: star ratings, tag chips, adding photos, and the claim progress timeline.
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { takePhoto } from "../../../shared/photo";
import { Button, Notice, T, useTheme } from "../../../shared/ui";

export const STAR_LABEL = ["Tap a star", "Poor", "Fair", "Good", "Great", "Excellent"];

export function Stars({ value, onChange, size = 44, label = "Overall rating", testPrefix = "star" }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 4 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={onChange ? () => onChange(n) : undefined} disabled={!onChange} accessibilityRole="radio" accessibilityState={{ checked: value === n }}
          accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`} testID={`${testPrefix}-${n}`} hitSlop={4}>
          <Text style={{ fontSize: size, lineHeight: size * 1.15, color: n <= (value || 0) ? "#F5A524" : t.c.line }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Pick any number of tags. options: [value, label]
export function TagChips({ options, value, onChange, testID }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID={testID}>
      {options.map(([v, l]) => {
        const on = value.includes(v);
        return (
          <Pressable key={v} onPress={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
            style={{ borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, borderColor: on ? t.c.brand : t.c.line, backgroundColor: on ? t.c.brandSoft : t.c.inputBg }}>
            <Text style={{ fontFamily: t.f.bodyB, fontSize: 14, color: on ? t.c.brand : t.c.ink }}>{on ? "✓ " : ""}{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Take or choose up to `max` photos. value: [{ contentType, data }]
export function PhotoPicker({ value, onChange, max = 4, label, hint, error }) {
  const t = useTheme();
  const [err, setErr] = useState(null);
  async function add(library) {
    setErr(null);
    try { const p = await takePhoto({ library }); if (p) onChange([...value, p].slice(0, max)); } catch (e) { setErr(e.message); }
  }
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={t.text.label}>{label}</Text> : null}
      {value.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {value.map((p, i) => (
            <Pressable key={i} onPress={() => onChange(value.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}
              style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden", backgroundColor: t.c.line }}>
              <Image source={{ uri: `data:${p.contentType};base64,${p.data}` }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              <View style={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "#000A", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 12, fontFamily: t.f.bodyX }}>×</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {value.length < max ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button style={{ flex: 1 }} title="Take photo" variant="ghost" onPress={() => add(false)} testID="take-photo" />
          <Button style={{ flex: 1 }} title="Choose photo" variant="ghost" onPress={() => add(true)} testID="choose-photo" />
        </View>
      ) : null}
      {hint ? <T v="hint">{hint}</T> : null}
      {err || error ? <Notice tone="bad">{err || error}</Notice> : null}
    </View>
  );
}

export const CLAIM_STEPS = [
  ["Submitted", "We received your claim and photos."],
  ["Partner response", "Your partner has 48 hours to respond."],
  ["Evidence review", "We compare the check-in photos taken before work with yours."],
  ["Decision", "Within 5 business days of the partner's response."],
  ["Resolved", "Paid through the job's insurance, repaired, or credited."],
];

export function Timeline({ steps, at }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10 }} testID="claim-timeline">
      {steps.map(([title, sub], i) => {
        const done = i < at || at === steps.length - 1;
        const now = i === at;
        return (
          <View key={title} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: done ? t.c.brand : now ? t.c.brandSoft : t.c.line }}>
              <Text style={{ fontFamily: t.f.bodyX, fontSize: 12, color: done ? "#fff" : t.c.brand }}>{done ? "✓" : i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[t.text.small, { fontFamily: t.f.bodyX, color: done || now ? t.c.ink : t.c.muted }]}>{title}</Text>
              <T v="hint">{sub}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}
