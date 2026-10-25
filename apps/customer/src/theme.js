// Colors and type from prototypes/customer-app.html (light and dark).
const light = {
  brand: "#1550E6", brandDeep: "#0A2A7A", brandSoft: "#E6EEFF", sky: "#BFD6FF",
  bg: "#EEF2F9", surface: "#FFFFFF", ink: "#0E1A33", muted: "#5B6782", line: "#D5DCEA",
  ok: "#12A150", okSoft: "#DDF5E7", bad: "#D9363E", badSoft: "#FDECEC",
};
const dark = {
  brand: "#4B7BFF", brandDeep: "#0B1C4A", brandSoft: "#16264F", sky: "#20366E",
  bg: "#070D1C", surface: "#101A31", ink: "#E8EEFC", muted: "#93A0BE", line: "#24324F",
  ok: "#12A150", okSoft: "#0F3322", bad: "#D9363E", badSoft: "#3A1518",
};

export const fonts = {
  display: "Archivo_700Bold", displayX: "Archivo_800ExtraBold",
  body: "Manrope_500Medium", bodyR: "Manrope_400Regular", bodyB: "Manrope_700Bold", bodyS: "Manrope_600SemiBold", bodyX: "Manrope_800ExtraBold",
};

export function makeTheme(scheme) {
  const isDark = scheme === "dark";
  const p = isDark ? dark : light;
  const f = fonts;
  return {
    dark: isDark,
    p,
    f,
    maxWidth: 430,
    c: {
      screen: p.surface, surface: p.surface, ink: p.ink, muted: p.muted, line: p.line, brand: p.brand, brandSoft: p.brandSoft,
      bad: p.bad, okText: isDark ? "#4ADE80" : p.ok, inputBg: p.surface, placeholder: isDark ? "#5F6C8A" : "#98A2B8",
      // The engine mark is deep navy on light; on dark the deep color is too dark to see, so it uses the sky tone.
      logo: isDark ? "#BFD6FF" : p.brandDeep, logoHole: isDark ? p.surface : "#fff",
    },
    text: {
      h1: { fontFamily: f.displayX, fontSize: 28, color: p.ink, lineHeight: 33 },
      title: { fontFamily: f.displayX, fontSize: 20, color: p.ink },
      body: { fontFamily: f.body, fontSize: 15, color: p.ink, lineHeight: 21 },
      muted: { fontFamily: f.body, fontSize: 15, color: p.muted, lineHeight: 21 },
      small: { fontFamily: f.body, fontSize: 14, color: p.ink, lineHeight: 20 },
      label: { fontFamily: f.bodyB, fontSize: 12, color: p.muted, letterSpacing: 0.36 },
      hint: { fontFamily: f.body, fontSize: 12, color: p.muted, lineHeight: 17 },
      err: { fontFamily: f.bodyS, fontSize: 13, color: p.bad },
      link: { fontFamily: f.bodyX, fontSize: 15, color: p.brand },
    },
    input: {
      fontFamily: f.body, fontSize: 15, color: p.ink, backgroundColor: p.surface,
      borderWidth: 1.5, borderColor: p.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 48,
    },
    button: {
      base: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 52 },
      big: {},
      text: { fontFamily: f.displayX, fontSize: 16, letterSpacing: 0.64 },
      bigText: {},
      primary: { box: { backgroundColor: p.brand }, text: { color: "#fff" } },
      ghost: { box: { backgroundColor: p.brandSoft }, text: { color: p.brand } },
      danger: { box: { backgroundColor: p.badSoft }, text: { color: p.bad } },
    },
    notice: {
      box: { borderWidth: 1, borderColor: p.line, borderRadius: 14, padding: 12 },
      info: { backgroundColor: p.brandSoft },
      bad: { backgroundColor: p.badSoft, borderColor: "transparent" },
      ok: { backgroundColor: p.okSoft, borderColor: "transparent" },
    },
  };
}
