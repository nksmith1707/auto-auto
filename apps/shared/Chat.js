// In-app chat between a customer and their partner. Phone numbers and emails are hidden by the server.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fmtWhen } from "./format";
import { useAuth } from "./session";
import { useTheme } from "./ui";

export function ChatScreen({ jobId, title, header, background }) {
  const t = useTheme();
  const { call } = useAuth();
  const [msgs, setMsgs] = useState(null);
  const [canSend, setCanSend] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const list = useRef(null);

  const load = useCallback(async () => {
    try { const r = await call("messages", jobId); setMsgs(r.messages); setCanSend(r.canSend); }
    catch (e) { setNote(e.message); setMsgs((m) => m || []); }
  }, [call, jobId]);
  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, [load]);
  useEffect(() => { if (msgs && msgs.length && list.current) setTimeout(() => list.current && list.current.scrollToEnd({ animated: false }), 50); }, [msgs]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await call("sendMessage", jobId, body);
      setText("");
      if (r.hidden) setNote("Phone numbers and emails are hidden. Keep in touch here in the app.");
      await load();
    } catch (e) { setNote(e.message); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.c.screen }} edges={["top", "bottom", "left", "right"]}>
      {background}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: 16 }}>{header}</View>
        <Text style={[t.text.title, { paddingHorizontal: 16, paddingBottom: 8 }]} accessibilityRole="header">{title}</Text>
        {!msgs ? <ActivityIndicator color={t.c.brand} style={{ marginTop: 24 }} /> : (
          <FlatList ref={list} data={msgs} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
            ListEmptyComponent={<Text style={[t.text.hint, { textAlign: "center", marginTop: 24 }]}>No messages yet. Say hi, share gate codes, or ask a question.</Text>}
            renderItem={({ item: m }) => (
              <View style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "82%", gap: 2 }}>
                <View style={{ backgroundColor: m.mine ? t.c.brand : t.c.surface, borderWidth: m.mine ? 0 : 1, borderColor: t.c.line, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13 }}>
                  <Text style={[t.text.body, { color: m.mine ? "#fff" : t.c.ink }]} selectable>{m.body}</Text>
                </View>
                <Text style={[t.text.hint, { alignSelf: m.mine ? "flex-end" : "flex-start", fontSize: 11 }]}>{fmtWhen(m.at)}</Text>
              </View>
            )} />
        )}
        {note ? <Text style={[t.text.hint, { paddingHorizontal: 16, paddingBottom: 6 }]}>{note}</Text> : null}
        {canSend ? (
          <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: t.c.line, alignItems: "flex-end" }}>
            <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={t.c.placeholder} multiline maxLength={1000}
              style={[t.input, { flex: 1, minHeight: 44, maxHeight: 120 }]} accessibilityLabel="Message" testID="chat-input" />
            <Pressable onPress={send} accessibilityRole="button" accessibilityLabel="Send" testID="chat-send"
              style={{ backgroundColor: t.c.brand, borderRadius: 12, paddingHorizontal: 16, height: 48, justifyContent: "center", opacity: text.trim() && !busy ? 1 : 0.5 }}>
              <Text style={{ color: "#fff", fontFamily: t.f.bodyX, fontSize: 15 }}>Send</Text>
            </Pressable>
          </View>
        ) : msgs ? <Text style={[t.text.hint, { textAlign: "center", padding: 12 }]}>Messages for this job are closed.</Text> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
