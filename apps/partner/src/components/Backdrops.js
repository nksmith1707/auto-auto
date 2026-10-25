// Background gradients from the partner prototype.
import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { p } from "../theme";

// Splash: radial glow, 120% × 70% at 50% 35%.
export const SplashGlow = () => (
  <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
    <Defs>
      <RadialGradient id="sg" cx="0.5" cy="0.35" r="1" fx="0.5" fy="0.35" gradientTransform="translate(0.5 0.35) scale(1.2 0.7) translate(-0.5 -0.35)">
        <Stop offset="0" stopColor="#1A3A9E" />
        <Stop offset="0.55" stopColor={p.navy} />
        <Stop offset="1" stopColor={p.bg} />
      </RadialGradient>
    </Defs>
    <Rect width="100%" height="100%" fill="url(#sg)" />
  </Svg>
);

// Login and apply: deep blue at the top fading into the page by 42% of the height.
export const HeroFade = () => (
  <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
    <Defs>
      <LinearGradient id="hf" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={p.heroTop} />
        <Stop offset="0.42" stopColor={p.bg} />
        <Stop offset="1" stopColor={p.bg} />
      </LinearGradient>
    </Defs>
    <Rect width="100%" height="100%" fill="url(#hf)" />
  </Svg>
);
