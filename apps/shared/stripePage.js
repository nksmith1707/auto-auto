// Opens one of Stripe's pages (add a card, set up payouts) and comes back to the app when it's done.
// On phones it opens in an in-app browser; on the web it opens in the same tab and the page reloads on return.
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

export const returnUrl = (path) => Linking.createURL(path);

// start(returnUrl) asks our server for the Stripe link. Resolves when the person is back in the app.
// No link back means there's nothing to open (for example, the ID check already finished).
export async function openStripePage(path, start) {
  const back = returnUrl(path);
  const { url } = (await start(back)) || {};
  if (!url) return { finished: true, opened: false };
  if (Platform.OS === "web") {
    window.location.assign(url);
    return new Promise(() => {}); // The page is leaving.
  }
  const r = await WebBrowser.openAuthSessionAsync(url, back);
  return { finished: r.type === "success" && /[?&]done=1/.test(r.url || "") };
}
