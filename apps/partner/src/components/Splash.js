import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { EngineLogo } from "../../../shared/Logo";
import { fonts, p } from "../theme";
import { SplashGlow } from "./Backdrops";
import { PartnerBadge } from "./PartnerBadge";

export function Splash() {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) w.setValue(1);
      else Animated.timing(w, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
    }).catch(() => w.setValue(1));
  }, [w]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: p.bg }]} accessibilityLabel="Auto Auto Partner. Your shop. Your hours. Your area. Loading.">
      <SplashGlow />
      {/* Wrapped so it draws above the gradient on web too. */}
      <View><EngineLogo size={130} color={p.brandText} accent={p.money} hole={p.navy} /></View>
      <Text style={styles.wm}>Auto Auto</Text>
      <PartnerBadge />
      <Text style={styles.tagline}>Your shop. Your hours. Your area.</Text>
      <View style={styles.bar}>
        <Animated.View style={{ height: "100%", backgroundColor: p.money, width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", gap: 14, zIndex: 10, paddingHorizontal: 16 },
  wm: { fontFamily: fonts.displayH, fontSize: 40, letterSpacing: 2.4, textTransform: "uppercase", color: p.ink },
  tagline: { fontFamily: fonts.bodyB, fontSize: 12, letterSpacing: 2.4, textTransform: "uppercase", color: p.muted, textAlign: "center" },
  bar: { width: 150, height: 4, borderRadius: 4, overflow: "hidden", marginTop: 16, backgroundColor: "rgba(255,255,255,0.12)" },
});
