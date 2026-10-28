// Small pieces shared by the business (fleet) screens.
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../shared/ui";

// Pick several from a list. options: [[value, label]]
export function MultiChips({ label, value, onChange, options, testID }) {
  const t = useTheme();
  const set = new Set(value);
  return (
    <View style={{ gap: 6 }} testID={testID}>
      {label ? <Text style={t.text.label}>{label}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map(([v, l]) => {
          const on = set.has(v);
          return (
            <Pressable key={v} onPress={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              style={{ borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, minHeight: 40, justifyContent: "center", borderColor: on ? t.c.brand : t.c.line, backgroundColor: on ? t.c.brand : t.c.inputBg }}>
              <Text style={{ fontFamily: t.f.bodyB, fontSize: 14, color: on ? "#fff" : t.c.ink }}>{on ? "✓ " : ""}{l}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const TONES = { ok: ["#DDF5E7", "#0F7A3E"], warn: ["#FFF1D6", "#8A5A00"], bad: ["#FDECEC", "#B4232B"], brand: ["#E7EEFF", "#1550E6"], muted: ["#EEF1F7", "#5E6A86"] };
export function Pill({ children, tone = "muted", testID }) {
  const [bg, fg] = TONES[tone];
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }} testID={testID}>
      <Text style={{ color: fg, fontSize: 12, fontFamily: "Manrope_800ExtraBold" }}>{children}</Text>
    </View>
  );
}

export const VEHICLE_STATUS = { ok: ["OK", "ok"], due: ["Due soon", "warn"], overdue: ["Overdue", "bad"] };
export const RUN_STATUS = { posted: ["Looking for a partner", "brand"], claimed: ["Partner confirmed", "ok"], active: ["In progress", "warn"], completed: ["Done & invoiced", "ok"], cancelled: ["Cancelled", "muted"] };
export const FLEET_STATUS = { review: ["Credit check in progress", "warn"], active: ["Active", "ok"], declined: ["Not approved", "bad"], paused: ["Paused", "bad"] };
