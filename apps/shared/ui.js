// Building blocks for both apps. Each app passes its own theme (colors and fonts from its prototype).
import { createContext, forwardRef, useContext, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ThemeContext = createContext(null);
export const ThemeProvider = ({ theme, children }) => <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
export const useTheme = () => useContext(ThemeContext);

// A scrolling page that stays clear of the notch and the keyboard.
export function Screen({ children, style, contentStyle, background, scroll = true, refreshControl }) {
  const t = useTheme();
  const body = scroll ? (
    <ScrollView contentContainerStyle={[{ flexGrow: 1, paddingHorizontal: 16 }, contentStyle]} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
      <View style={{ flex: 1, width: "100%", maxWidth: t.maxWidth, alignSelf: "center" }}>{children}</View>
    </ScrollView>
  ) : children;
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: t.c.screen }, style]} edges={["top", "bottom", "left", "right"]}>
      {background}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>{body}</KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function T({ v = "body", style, ...rest }) {
  const t = useTheme();
  return <Text style={[t.text[v], style]} {...rest} />;
}

export const Field = forwardRef(function Field({ label, error, hint, style, secure, ...input }, ref) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={t.text.label}>{label}</Text>
      <View>
        <TextInput
          ref={ref}
          style={[t.input, input.multiline && { minHeight: 90, textAlignVertical: "top" }, input.editable === false && { opacity: 0.6 },
            focus && { borderColor: t.c.brand }, error && { borderColor: t.c.bad }, secure && { paddingRight: 64 }]}
          placeholderTextColor={t.c.placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          secureTextEntry={secure && !show}
          accessibilityLabel={label}
          autoCorrect={false}
          {...input}
        />
        {secure ? (
          <Pressable onPress={() => setShow((s) => !s)} style={styles.reveal} accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} hitSlop={8}>
            <Text style={[t.text.link, { fontSize: 13 }]}>{show ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={t.text.err} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={t.text.hint}>{hint}</Text> : null}
    </View>
  );
});

export function Button({ title, onPress, variant = "primary", loading, disabled, style, big, testID }) {
  const t = useTheme();
  const v = t.button[variant] || t.button.primary;
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={title}
      testID={testID}
      style={({ pressed }) => [t.button.base, big && t.button.big, v.box, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={v.text.color} /> : <Text style={[t.button.text, big && t.button.bigText, v.text]}>{title}</Text>}
    </Pressable>
  );
}

export function LinkButton({ title, onPress, style, textStyle }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={[{ paddingVertical: 6 }, style]}>
      <Text style={[t.text.link, textStyle]}>{title}</Text>
    </Pressable>
  );
}

// Words (or words mixed with numbers) must sit inside <Text> on phones, or the screen crashes.
const isPlainText = (c) => typeof c === "string" || typeof c === "number" || (Array.isArray(c) && c.every((x) => x == null || typeof x === "string" || typeof x === "number"));

export function Notice({ children, tone = "info", style }) {
  const t = useTheme();
  const tones = { info: t.notice.info, bad: t.notice.bad, ok: t.notice.ok };
  return (
    <View style={[t.notice.box, tones[tone], style]} accessibilityLiveRegion="polite">
      {isPlainText(children) ? <Text style={[t.text.small, tone === "bad" && { color: t.c.bad }, tone === "ok" && { color: t.c.okText }]}>{children}</Text> : children}
    </View>
  );
}

export function Checkbox({ checked, onChange, children, error }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={[styles.box, { borderColor: error ? t.c.bad : checked ? t.c.brand : t.c.line, backgroundColor: checked ? t.c.brand : t.c.inputBg }]}>
          {checked ? <Text style={{ color: "#fff", fontSize: 13, lineHeight: 16, fontFamily: t.f.bodyX }}>✓</Text> : null}
        </View>
        <Text style={[t.text.small, { flex: 1 }]}>{children}</Text>
      </Pressable>
      {error ? <Text style={t.text.err}>{error}</Text> : null}
    </View>
  );
}

// The two-tab switch from the customer prototype (Log in / Sign up).
export function Tabs({ value, onChange, options }) {
  const t = useTheme();
  return (
    <View style={[styles.tabs, { backgroundColor: t.c.brandSoft }]} accessibilityRole="tablist">
      {options.map(([k, label]) => {
        const on = k === value;
        return (
          <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[styles.tab, on && { backgroundColor: t.c.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}>
            <Text style={{ fontFamily: t.f.bodyB, fontSize: 15, color: on ? t.c.brand : t.c.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Pick one from a few choices (fuel type, parking, oil). options: [[value, label], ...]
export function Chips({ label, value, onChange, options, error, allowNone = false, testID }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }} testID={testID}>
      {label ? <Text style={t.text.label}>{label}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(([v, l]) => {
          const on = v === value;
          return (
            <Pressable key={String(v)} onPress={() => onChange(on && allowNone ? null : v)} accessibilityRole="radio" accessibilityState={{ checked: on }}
              style={[styles.chip, { borderColor: on ? t.c.brand : t.c.line, backgroundColor: on ? t.c.brand : t.c.inputBg }]}>
              <Text style={{ fontFamily: t.f.bodyB, fontSize: 14, color: on ? "#fff" : t.c.ink }}>{l}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={t.text.err}>{error}</Text> : null}
    </View>
  );
}

// A bordered box for lists and summaries.
export function Card({ children, style, onPress, accessibilityLabel, testID }) {
  const t = useTheme();
  const box = [{ borderWidth: 1, borderColor: t.c.line, backgroundColor: t.c.surface, borderRadius: 16, padding: 14 }, style];
  if (!onPress) return <View style={box} testID={testID}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID}
      style={({ pressed }) => [box, pressed && { borderColor: t.c.brand }]}>
      {children}
    </Pressable>
  );
}

// "Remove" with an inline are-you-sure, since pop-up alerts don't work everywhere.
export function ConfirmRemove({ label, question, onConfirm, testID }) {
  const t = useTheme();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!ask) return <LinkButton title={label} onPress={() => setAsk(true)} style={{ alignSelf: "center" }} textStyle={{ color: t.c.bad }} />;
  return (
    <View style={{ gap: 10 }}>
      <Text style={[t.text.small, { textAlign: "center" }]}>{question}</Text>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button style={{ flex: 1 }} title="Keep" variant="ghost" onPress={() => setAsk(false)} />
        <Button style={{ flex: 1 }} title="Remove" variant="danger" loading={busy} testID={testID}
          onPress={async () => { setErr(null); setBusy(true); try { await onConfirm(); } catch (e) { setErr(e.message); setBusy(false); } }} />
      </View>
    </View>
  );
}

// Returns a state updater that drops one field's error, for use when that field changes.
export const dropFieldError = (k) => (e) => (e && e.fields && e.fields[k] ? { ...e, fields: { ...e.fields, [k]: undefined } } : e);

// Turns an API error into a top message plus per-field messages.
export function errorParts(e) {
  if (!e) return { message: null, fields: {} };
  const fields = e.fields || {};
  const hasFields = Object.keys(fields).length > 0;
  return { message: hasFields && e.code === "invalid_input" ? null : e.message, fields };
}

const styles = StyleSheet.create({
  reveal: { position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  tabs: { flexDirection: "row", borderRadius: 12, padding: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 9 },
  chip: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
});
