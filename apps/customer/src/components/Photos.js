// Visit photos for customers: thumbnails that open full size, plus any damage the partner noted at check-in.
import { useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { useAuth } from "../../../shared/session";
import { T, useTheme } from "../../../shared/ui";

export function PhotoRow({ title, photos, testID }) {
  const t = useTheme();
  const { api } = useAuth();
  const [open, setOpen] = useState(null);
  if (!photos || !photos.length) return null;
  return (
    <View style={{ gap: 6 }} testID={testID}>
      {title ? <Text style={t.text.label}>{title}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {photos.map((x) => (
          <Pressable key={x.id} onPress={() => setOpen(x)} accessibilityRole="imagebutton" accessibilityLabel={`${x.label} photo`}
            style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden", borderWidth: x.damageNote ? 2 : 0, borderColor: t.c.bad, backgroundColor: t.c.line }}>
            <Image source={{ uri: api.url(x.url) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          </Pressable>
        ))}
      </View>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable onPress={() => setOpen(null)} style={{ flex: 1, backgroundColor: "#000E", justifyContent: "center", padding: 16, gap: 10 }} accessibilityLabel="Close photo">
          {open ? (
            <>
              <Image source={{ uri: api.url(open.url) }} style={{ width: "100%", aspectRatio: 3 / 4 }} resizeMode="contain" />
              <Text style={{ color: "#fff", fontFamily: t.f.bodyB, fontSize: 15, textAlign: "center" }}>{open.label}{open.damageNote ? ` · Existing damage: ${open.damageNote}` : ""}</Text>
              <Text style={{ color: "#fffa", fontFamily: t.f.body, fontSize: 13, textAlign: "center" }}>Tap anywhere to close</Text>
            </>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

export function VisitPhotos({ photos }) {
  if (!photos || (!photos.checkin.length && !photos.after.length)) return null;
  return (
    <View style={{ gap: 10 }}>
      <PhotoRow title="Before (check-in)" photos={photos.checkin} testID="checkin-photos" />
      {photos.damage && photos.damage.length ? (
        <T v="small">Existing damage noted before work: {photos.damage.map((d) => `${d.label}: ${d.note}`).join("; ")}.</T>
      ) : null}
      <PhotoRow title="After" photos={photos.after} testID="after-photos" />
    </View>
  );
}
