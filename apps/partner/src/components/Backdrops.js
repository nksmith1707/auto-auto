// Background gradients from the partner prototype.
import { GradientFill } from "../../../shared/Fill";
import { p } from "../theme";

// Splash: radial glow, 120% × 70% at 50% 35%.
export const SplashGlow = () => (
  <GradientFill radial={{ cx: 0.5, cy: 0.35 }} radius={{ x: 1.2, y: 0.7 }} stops={[[0, "#1A3A9E"], [0.55, p.navy], [1, p.bg]]} />
);

// Login and apply: deep blue at the top fading into the page by 42% of the height.
export const HeroFade = () => (
  <GradientFill stops={[[0, p.heroTop], [0.42, p.bg], [1, p.bg]]} />
);
