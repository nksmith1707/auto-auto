// Session storage on phones: the iOS Keychain / Android Keystore via expo-secure-store.
import * as SecureStore from "expo-secure-store";

export const storage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
