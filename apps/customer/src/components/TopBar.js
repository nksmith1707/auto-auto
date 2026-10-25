// Back button + engine mark, like the prototype's inner pages.
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { EngineLogo } from "../../../shared/Logo";
import { useTheme } from "../../../shared/ui";

export function TopBar({ onBack }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={t.c.logo} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M15 18l-6-6 6-6" />
          </Svg>
        </Pressable>
      ) : <View style={{ width: 42 }} />}
      <EngineLogo size={56} color={t.c.logo} hole={t.c.logoHole} />
      <View style={{ width: 42 }} />
    </View>
  );
}
