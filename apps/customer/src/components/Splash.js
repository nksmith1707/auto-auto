import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { GradientFill } from "../../../shared/Fill";
import { EngineLogo } from "../../../shared/Logo";
import { useTheme } from "../../../shared/ui";

export function Splash() {
  const t = useTheme();
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) w.setValue(1);
      else Animated.timing(w, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
    }).catch(() => w.setValue(1));
  }, [w]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: t.p.sky }]} accessibilityLabel="Auto Auto. Keep Moving Forward. Loading.">
      <GradientFill stops={[[0, t.p.sky], [1, t.p.brandSoft]]} />
      <Text style={[styles.wordmark, { color: t.c.logo, fontFamily: t.f.displayX }]}>Auto Auto</Text>
      {/* Wrapped so it draws above the gradient on web too. */}
      <View><EngineLogo size={130} color={t.c.logo} hole={t.dark ? t.p.sky : "#fff"} /></View>
      <Text style={[styles.tag, { color: t.c.logo, borderTopColor: t.c.logo, fontFamily: t.f.display }]}>Keep Moving Forward</Text>
      <View style={[styles.bar, { backgroundColor: t.p.line }]}>
        <Animated.View style={{ height: "100%", backgroundColor: t.p.brand, width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", gap: 14, zIndex: 10 },
  wordmark: { fontSize: 40, letterSpacing: 2.4, textTransform: "uppercase" },
  tag: { fontSize: 13, letterSpacing: 1.8, textTransform: "uppercase", borderTopWidth: 2, paddingTop: 6 },
  bar: { width: 140, height: 4, borderRadius: 4, overflow: "hidden", marginTop: 18 },
});
