// Check-in and after photos: a grid of labeled slots. Tap an empty slot to take the photo; tap a taken one
// to note existing damage or retake it. Photos are shrunk on the phone before upload so they send fast on cellular.
import { useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useAuth } from "../../../shared/session";
import { Button, Field } from "../../../shared/ui";
import { fonts, p } from "../theme";

// Opens the camera (or the photo library on the web) and returns a resized JPEG as base64, or null if canceled.
export async function takePhoto({ library = false } = {}) {
  const useLibrary = library || Platform.OS === "web";
  const perm = useLibrary ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error(useLibrary ? "Allow photo access in Settings to add photos." : "Allow camera access in Settings to take photos.");
  const opts = { mediaTypes: ["images"], quality: 0.8, exif: false };
  const r = useLibrary ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts);
  if (r.canceled) return null;
  const a = r.assets[0];
  try {
    const ctx = ImageManipulator.manipulate(a.uri);
    if ((a.width || 0) > 1600) ctx.resize({ width: 1600 });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
    return { contentType: "image/jpeg", data: out.base64 };
  } catch {
    // Fall back to the original if resizing isn't available (some web browsers).
    const blob = a.file || (await (await fetch(a.uri)).blob());
    const data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, "")); fr.onerror = reject; fr.readAsDataURL(blob); });
    return { contentType: (a.mimeType || "image/jpeg").replace("image/jpg", "image/jpeg"), data };
  }
}

export const CHECKIN_SLOTS = [["e0", "Front"], ["e1", "Front right"], ["e2", "Right side"], ["e3", "Rear right"], ["e4", "Rear"], ["e5", "Rear left"], ["e6", "Left side"], ["e7", "Front left"]];
export const INTERIOR_SLOTS = [["i0", "Dash & odometer"], ["i1", "Front seats"], ["i2", "Rear seats"], ["i3", "Cargo area"]];
export const AFTER_SLOTS = [["a0", "After 1"], ["a1", "After 2"]];

function Slot({ label, photo, onPress, busy, testID }) {
  const { api } = useAuth();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}${photo ? ", taken" : ", take photo"}`} testID={testID}
      style={{ width: "31.5%", aspectRatio: 1, borderRadius: 12, overflow: "hidden", borderWidth: 1.5, borderStyle: photo ? "solid" : "dashed", borderColor: photo ? (photo.damageNote ? p.bad : p.ok) : p.line, backgroundColor: p.panel, alignItems: "center", justifyContent: "center" }}>
      {photo ? <Image source={{ uri: api.url(photo.url) }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" /> : null}
      {busy ? <ActivityIndicator color={p.brandText} /> : !photo ? <Text style={{ fontSize: 22, color: p.muted }}>📷</Text> : null}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: photo ? "#000A" : "transparent", paddingVertical: 3, paddingHorizontal: 4 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bodyB, fontSize: 10.5, color: photo ? "#fff" : p.muted, textAlign: "center" }}>{label}</Text>
      </View>
      {photo ? (
        <View style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: photo.damageNote ? p.bad : p.ok, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: photo.damageNote ? "#fff" : "#03200F", fontSize: 11, fontFamily: fonts.bodyX }}>{photo.damageNote ? "!" : "✓"}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// slots: [[slot, label]]. photos: the job's current photos for this group. allowDamage: check-in only.
// upload/note default to job photos; fleet vehicles pass their own.
export function PhotoGrid({ jobId, slots, photos, onChange, allowDamage, testPrefix = "photo", upload, note: saveNoteFn }) {
  const { call } = useAuth();
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(null); // slot being reviewed
  const [note, setNote] = useState("");
  const [err, setErr] = useState(null);
  const by = Object.fromEntries((photos || []).map((x) => [x.slot, x]));

  async function shoot(slot, library) {
    setErr(null);
    try {
      const shot = await takePhoto({ library });
      if (!shot) return;
      setBusy(slot);
      const r = upload ? await upload({ slot, ...shot }) : await call("uploadJobPhoto", jobId, { slot, ...shot });
      onChange(r.photos);
      setOpen(null);
    } catch (e) { setErr(e.fields ? Object.values(e.fields)[0] : e.message); }
    finally { setBusy(null); }
  }
  async function saveNote(slot) {
    setErr(null);
    setBusy(slot);
    try { onChange((saveNoteFn ? await saveNoteFn(slot, note) : await call("noteDamage", jobId, slot, note)).photos); setOpen(null); } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  const cur = open ? by[open] : null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {slots.map(([slot, label]) => (
          <Slot key={slot} label={label} photo={by[slot]} busy={busy === slot} testID={`${testPrefix}-${slot}`}
            onPress={() => { if (busy) return; if (by[slot]) { setOpen(slot); setNote(by[slot].damageNote || ""); } else shoot(slot); }} />
        ))}
      </View>
      {Platform.OS !== "web" && !open ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>Tap a square to take that photo. Tap a taken photo to {allowDamage ? "mark existing damage or " : ""}retake it.</Text> : null}
      {cur ? (
        <View style={{ gap: 8, backgroundColor: p.panel2, borderRadius: 14, padding: 12 }} testID="photo-panel">
          <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.ink }}>{cur.label}</Text>
          {allowDamage ? (
            <>
              <Field label="Existing damage (optional)" value={note} onChangeText={setNote} placeholder="e.g. Scuff on rear bumper, driver side" testID="damage-note" />
              <Button title="Save note" onPress={() => saveNote(open)} loading={busy === open} testID="damage-save" />
            </>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button style={{ flex: 1 }} title="Retake" variant="ghost" onPress={() => shoot(open)} />
            <Button style={{ flex: 1 }} title="Close" variant="ghost" onPress={() => setOpen(null)} />
          </View>
        </View>
      ) : null}
      {err ? <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.bad }}>{err}</Text> : null}
    </View>
  );
}
