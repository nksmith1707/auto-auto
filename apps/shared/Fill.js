// Paints a gradient behind a box. Measures the box first and draws the SVG at that exact size:
// on iPhone, an SVG sized "100%" doesn't stretch, so part of the box stayed unpainted and white text vanished.
// Always give the box a solid backgroundColor too, so it never shows white while measuring.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

let seq = 0;

export function GradientFill({ stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1, radial, radius }) {
  const [size, setSize] = useState(null);
  const [id] = useState(() => `g${++seq}`);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none"
      onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (!size || size.width !== width || size.height !== height) setSize({ width, height }); }}>
      {size && size.width > 0 && size.height > 0 ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            {radial ? (
              <RadialGradient id={id} cx={size.width * radial.cx} cy={size.height * radial.cy} rx={size.width * radius.x} ry={size.height * radius.y}
                fx={size.width * radial.cx} fy={size.height * radial.cy} gradientUnits="userSpaceOnUse">
                {stops.map(([o, c]) => <Stop key={o} offset={o} stopColor={c} />)}
              </RadialGradient>
            ) : (
              <LinearGradient id={id} x1={size.width * x1} y1={size.height * y1} x2={size.width * x2} y2={size.height * y2} gradientUnits="userSpaceOnUse">
                {stops.map(([o, c]) => <Stop key={o} offset={o} stopColor={c} />)}
              </LinearGradient>
            )}
          </Defs>
          <Rect x={0} y={0} width={size.width} height={size.height} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}
