// Taking or choosing a photo, shrunk on the phone (about 1600 pixels wide) so it uploads fast on cellular.
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

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
