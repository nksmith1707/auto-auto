// Colors and type from prototypes/partner-app.html. The partner app is dark only.
export const p = {
  bg: "#060C1B", panel: "#0C1630", panel2: "#132245", line: "#22345E", ink: "#EEF2FF", muted: "#8E9CC2",
  brand: "#3D6BFF", brandDeep: "#1543D6", brandSoft: "#16295A", brandText: "#9DB6FF", money: "#F5B83D", moneySoft: "#3A2C0C",
  ok: "#2FD07A", okSoft: "#0E3323", bad: "#FF5A62", badSoft: "#3A1219", navy: "#0A1638", heroTop: "#0F2161",
};

export const fonts = {
  display: "Archivo_700Bold", displayX: "Archivo_800ExtraBold", displayH: "Archivo_900Black",
  body: "Manrope_500Medium", bodyR: "Manrope_400Regular", bodyB: "Manrope_700Bold", bodyS: "Manrope_600SemiBold", bodyX: "Manrope_800ExtraBold",
};

const f = fonts;
export const theme = {
  dark: true,
  p,
  f,
  maxWidth: 460,
  c: {
    screen: p.bg, surface: p.panel, ink: p.ink, muted: p.muted, line: p.line, brand: p.brand, brandSoft: p.brandSoft,
    bad: p.bad, okText: p.ok, inputBg: p.panel, placeholder: "#56658C", logo: p.brandText, logoHole: p.navy,
  },
  text: {
    h1: { fontFamily: f.displayX, fontSize: 30, color: p.ink, lineHeight: 33 },
    title: { fontFamily: f.displayX, fontSize: 20, color: p.ink },
    body: { fontFamily: f.body, fontSize: 15, color: p.ink, lineHeight: 21 },
    muted: { fontFamily: f.body, fontSize: 15, color: p.muted, lineHeight: 21 },
    small: { fontFamily: f.body, fontSize: 14, color: p.ink, lineHeight: 20 },
    label: { fontFamily: f.bodyX, fontSize: 12, color: p.muted, letterSpacing: 0.72, textTransform: "uppercase" },
    hint: { fontFamily: f.body, fontSize: 12, color: p.muted, lineHeight: 17 },
    err: { fontFamily: f.bodyB, fontSize: 13, color: p.bad },
    link: { fontFamily: f.bodyX, fontSize: 15, color: p.brand },
  },
  input: {
    fontFamily: f.body, fontSize: 15, color: p.ink, backgroundColor: p.panel,
    borderWidth: 1.5, borderColor: p.line, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, minHeight: 50,
  },
  button: {
    base: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 52 },
    big: { paddingVertical: 19 },
    text: { fontFamily: f.displayX, fontSize: 16, letterSpacing: 0.32 },
    bigText: { fontSize: 19 },
    primary: { box: { backgroundColor: p.brand }, text: { color: "#fff" } },
    ghost: { box: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: p.line }, text: { color: p.ink } },
    danger: { box: { backgroundColor: p.badSoft }, text: { color: p.bad } },
    money: { box: { backgroundColor: p.money }, text: { color: "#241800" } },
    okb: { box: { backgroundColor: p.ok }, text: { color: "#03200F" } },
  },
  notice: {
    box: { borderWidth: 1, borderColor: p.line, borderRadius: 14, padding: 12 },
    info: { backgroundColor: p.panel },
    bad: { backgroundColor: p.badSoft, borderColor: "transparent" },
    ok: { backgroundColor: p.okSoft, borderColor: "transparent" },
  },
};
