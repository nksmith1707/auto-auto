// The engine mark from the prototypes. `accent` colors the gear (gold in the partner app); `hole` is the cutout ring.
import Svg, { Circle, Path, Rect } from "react-native-svg";

export function EngineLogo({ size = 110, color = "#0A2A7A", accent, hole = "#fff" }) {
  const gear = accent || color;
  return (
    <Svg width={size} height={size * 0.78} viewBox="0 0 140 110" fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={34} y={38} width={62} height={44} rx={6} fill={color} fillOpacity={0.9} />
      <Rect x={44} y={20} width={42} height={18} rx={4} />
      <Path d="M54 20v-8M76 20v-8M48 12h34" />
      <Path d="M34 52H22v20h12M96 50h10l8-8v34l-8-8H96" />
      <Path d="M46 82v10h38V82" />
      <Circle cx={65} cy={60} r={8} stroke={hole} />
      <Circle cx={116} cy={22} r={9} stroke={gear} />
      <Circle cx={116} cy={22} r={3} stroke={gear} />
      <Circle cx={103} cy={10} r={5} stroke={gear} />
    </Svg>
  );
}
