// Building blocks for the partner application screens: loading and saving a step, the "still needed" list,
// certificate uploads, and typed-name signatures.
import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../../../shared/session";
import { Button, Checkbox, Chips, Field, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "./Backdrops";
import { TopBar } from "./TopBar";
import { fonts, p } from "../theme";

export const card = { backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, padding: 16, gap: 12 };
export const label = { fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" };
export const body = { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: p.ink };
export const muted = { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: p.muted };
export const h3 = { fontFamily: fonts.displayX, fontSize: 17, color: p.ink };

// Loads the application whenever the screen shows. `form` is a local copy of one step's answers.
export function useApplication(stepId) {
  const { call, refresh } = useAuth();
  const [app, setApp] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const take = useCallback((s, resetForm) => {
    setApp(s);
    if (resetForm && stepId) setForm({ ...((s.answers || {})[stepId] || {}), ...(stepId === "business" ? { legalFirst: s.legalName.first || "", legalMiddle: s.legalName.middle || "", legalLast: s.legalName.last || "" } : {}) });
  }, [stepId]);
  const load = useCallback(async () => {
    try { take(await call("onboarding"), true); setErr(null); } catch (e) { setErr(e); }
  }, [call, take]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErr((e) => (e && e.fields && e.fields[k] ? { ...e, fields: { ...e.fields, [k]: undefined } } : e)); };
  async function run(which, fn) {
    setErr(null);
    setBusy(which);
    try { const s = await fn(); if (s && s.steps) take(s, false); refresh().catch(() => {}); return s; } catch (e) { setErr(e); return null; } finally { setBusy(null); }
  }
  const save = (patch) => run("save", () => call("saveStep", stepId, patch || form));
  const sign = (docId, name) => run(`sign-${docId}`, () => call("signDoc", docId, name));
  const step = app && stepId ? app.steps.find((s) => s.id === stepId) : null;
  return { app, setApp: (s) => take(s, false), form, set, setForm, err, setErr, busy, run, save, sign, load, step, call };
}

// Header, what's still needed, and the save button for one step.
export function StepScreen({ title, app, step, err, children, onSave, saving, saveLabel = "Save", testID }) {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const fieldErrs = err && err.fields ? Object.values(err.fields).filter(Boolean) : [];
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} title={title} />
      {!app ? (err ? <Notice tone="bad">{err.message}</Notice> : <ActivityIndicator color={p.brand} style={{ marginTop: 40 }} />) : (
        <View style={{ gap: 14 }}>
          {app.locked ? <Notice>We're reviewing your application, so it can't be changed right now.</Notice> : null}
          {children}
          {step && step.errors.length ? (
            <View style={[card, { borderColor: "#6B5212", backgroundColor: p.moneySoft, gap: 6 }]} testID="still-needed">
              <Text style={[label, { color: p.money }]}>Still needed</Text>
              {step.errors.map((e) => <Text key={e} style={body}>• {e}</Text>)}
            </View>
          ) : step ? (
            <View style={[card, { borderColor: p.ok, backgroundColor: p.okSoft }]} testID="step-done"><Text style={[body, { color: p.ok, fontFamily: fonts.bodyB }]}>✓ This step is complete</Text></View>
          ) : null}
          {err && !fieldErrs.length ? <Notice tone="bad">{err.message}</Notice> : null}
          {fieldErrs.length ? <Notice tone="bad">{fieldErrs.join(" ")}</Notice> : null}
          {onSave && !app.locked ? <Button title={saveLabel} onPress={onSave} loading={saving} testID={testID || "step-save"} /> : null}
        </View>
      )}
    </Screen>
  );
}

export function Section({ title, children, style }) {
  return (
    <View style={[card, style]}>
      {title ? <Text style={h3}>{title}</Text> : null}
      {children}
    </View>
  );
}

export const Pick = ({ label: l, value, onChange, options, error, testID }) => <Chips label={l} value={value || null} onChange={onChange} options={options} error={error} testID={testID} />;
export const Attest = ({ value, onChange, children, testID }) => <Checkbox checked={!!value} onChange={onChange} testID={testID}>{children}</Checkbox>;
export const Input = ({ form, set, k, err, ...rest }) => <Field value={form[k] == null ? "" : String(form[k])} onChangeText={set(k)} error={err && err.fields ? err.fields[k] : undefined} testID={`f-${k}`} {...rest} />;
export const DateInput = (props) => <Input placeholder="YYYY-MM-DD" autoCapitalize="none" keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"} maxLength={10} hint="Year-month-day, like 2027-08-31" {...props} />;

// Reads a picked file as base64, on phones and on the web.
async function asBase64(asset) {
  if (asset.base64) return asset.base64;
  const blob = asset.file || (await (await fetch(asset.uri)).blob());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("Couldn't read that file. Try another one."));
    r.readAsDataURL(blob);
  });
}

const DOC_STATUS = { pending: ["Uploaded · we'll review it", p.brandText], approved: ["Approved", p.ok], rejected: ["Not accepted", p.bad] };

// One certificate or license: shows what's on file and lets the partner upload a photo or PDF.
export function Upload({ kind, title, hint, app, onUploaded, locked }) {
  const { call } = useAuth();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const doc = app.documents.find((d) => d.kind === kind);
  async function send(asset, fallbackType) {
    if (!asset) return;
    setBusy("up");
    setErr(null);
    try {
      const data = await asBase64(asset);
      const type = (asset.mimeType || fallbackType || "").toLowerCase().replace("image/jpg", "image/jpeg");
      onUploaded(await call("uploadDoc", { kind, filename: asset.fileName || asset.name || `${kind}.${type.includes("pdf") ? "pdf" : "jpg"}`, contentType: type, data }));
    } catch (e) { setErr(e.fields && e.fields.file ? e.fields.file : e.message); }
    finally { setBusy(null); }
  }
  async function photo(camera) {
    setErr(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setErr(camera ? "Allow camera access in Settings to take a photo." : "Allow photo access in Settings to pick a photo.");
    const opts = { mediaTypes: ["images"], quality: 0.6, base64: true, exif: false };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled) await send(r.assets[0], "image/jpeg");
  }
  async function file() {
    setErr(null);
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png", "image/heic"], copyToCacheDirectory: true, multiple: false });
    if (!r.canceled) await send(r.assets[0]);
  }
  const [stLabel, stColor] = doc ? DOC_STATUS[doc.status] : ["Not uploaded", p.muted];
  return (
    <View style={{ gap: 8, borderWidth: 1.5, borderStyle: doc ? "solid" : "dashed", borderColor: doc && doc.status === "rejected" ? p.bad : p.line, borderRadius: 14, padding: 12 }} testID={`upload-${kind}`}>
      <Text style={[body, { fontFamily: fonts.bodyB }]}>{title}</Text>
      {hint ? <Text style={muted}>{hint}</Text> : null}
      <Text style={[muted, { color: stColor, fontFamily: fonts.bodyB }]}>{doc ? `${doc.filename} · ${stLabel}` : stLabel}</Text>
      {doc && doc.status === "rejected" && doc.reviewNote ? <Text style={[muted, { color: p.bad }]}>{doc.reviewNote}</Text> : null}
      {err ? <Text style={[muted, { color: p.bad }]}>{err}</Text> : null}
      {locked ? null : busy ? <ActivityIndicator color={p.brand} /> : (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {Platform.OS !== "web" ? <SmallButton title="Take photo" onPress={() => photo(true)} /> : null}
          <SmallButton title={Platform.OS === "web" ? "Choose photo" : "Choose photo"} onPress={() => photo(false)} testID={`photo-${kind}`} />
          <SmallButton title="Choose PDF" onPress={file} testID={`pdf-${kind}`} />
        </View>
      )}
    </View>
  );
}

export function SmallButton({ title, onPress, testID }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}
      style={({ pressed }) => ({ backgroundColor: pressed ? p.brandDeep : p.panel2, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 })}>
      <Text style={{ fontFamily: fonts.bodyX, fontSize: 13, color: p.ink }}>{title}</Text>
    </Pressable>
  );
}

// Typed-name signature. Shows when and how it was signed once done.
export function SignBox({ docId, app, onSign, busy, err, locked, buttonTitle = "Sign" }) {
  const [name, setName] = useState("");
  const sig = app.signatures[docId];
  const legal = [app.legalName.first, app.legalName.middle, app.legalName.last].filter(Boolean).join(" ");
  if (sig) {
    return <Text style={[muted, { color: p.ok, fontFamily: fonts.bodyB }]} testID={`signed-${docId}`}>✓ Signed as {sig.name} · {new Date(sig.signedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</Text>;
  }
  if (locked) return null;
  if (!app.signatures.esign) return <Text style={muted}>Agree to sign electronically in Business & tax first.</Text>;
  if (!legal) return <Text style={muted}>Add your legal name in Business & tax first.</Text>;
  return (
    <View style={{ gap: 8 }}>
      <Field label="Type your full legal name to sign" value={name} onChangeText={setName} placeholder={legal} autoCapitalize="words" autoCorrect={false}
        hint={`Must match: ${legal}`} error={err && err.fields && err.fields.name} testID={`sig-${docId}`} />
      <Button title={buttonTitle} onPress={() => onSign(docId, name)} loading={busy} disabled={!name.trim()} testID={`sign-${docId}`} />
    </View>
  );
}

// A document's text from the server (agreements, disclosures).
export function DocText({ doc }) {
  if (!doc) return <ActivityIndicator color={p.brand} />;
  return (
    <View style={{ gap: 10 }}>
      <Text style={h3}>{doc.title}</Text>
      {doc.paragraphs.map((x, i) => (
        <View key={i} style={{ gap: 2 }}>
          {x.heading ? <Text style={[body, { fontFamily: fonts.bodyB }]}>{x.heading}</Text> : null}
          <Text style={body}>{x.text}</Text>
        </View>
      ))}
      <Text style={[muted, { fontSize: 12 }]}>{doc.draftNote} · version {doc.version}</Text>
    </View>
  );
}

