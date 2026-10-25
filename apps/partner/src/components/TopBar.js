import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { fonts, p } from "../theme";

export function TopBar({ onBack, title }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12 }}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back"
        style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: p.panel, alignItems: "center", justifyContent: "center" }}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={p.ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 18l-6-6 6-6" /></Svg>
      </Pressable>
      <Text style={{ flex: 1, textAlign: "center", fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase", marginRight: 42 }}>{title}</Text>
    </View>
  );
}
