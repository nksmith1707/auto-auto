// Phone alerts. The phone gets an address from Expo's push service, and we save it on the server so updates can
// reach this phone. Phone alerts need the app's own build (App Store / Google Play, step 14) or an Expo project ID;
// until then everything still lands in the in-app inbox, by text, and by email.
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { storage } from "./storage";

const KEY = "aa.push.token";

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
} catch { /* not available here (web) */ }

// Returns { ok: true } or { ok: false, reason } with a sentence people can read.
export async function registerPush(call, { ask = true } = {}) {
  if (Platform.OS === "web") return { ok: false, reason: "Phone alerts work in the phone app, not in a web browser." };
  const projectId = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId) || (Constants.easConfig && Constants.easConfig.projectId);
  if (!projectId) return { ok: false, reason: "Phone alerts turn on with the App Store and Google Play version of the app. Until then, updates show here and come by text or email." };
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && ask && perm.canAskAgain !== false) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: "Notifications are off for Auto-Auto. Turn them on in your phone's Settings." };
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Updates", importance: Notifications.AndroidImportance.MAX });
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await call("addPushToken", token, Platform.OS);
    await storage.set(KEY, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Couldn't turn on phone alerts: ${e.message}` };
  }
}

// On log out, this phone stops getting alerts for the account.
export async function forgetPush(call) {
  try {
    const token = await storage.get(KEY);
    if (token) { await call("removePushToken", token); await storage.remove(KEY); }
  } catch { /* the server drops it on its own when the phone stops accepting them */ }
}

// Tapping an alert opens the screen it's about.
export function listenForTaps(onOpen) {
  if (Platform.OS === "web") return () => {};
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r && r.notification && r.notification.request && r.notification.request.content && r.notification.request.content.data;
      if (data && data.route) onOpen(data);
    });
    return () => sub.remove();
  } catch { return () => {}; }
}
