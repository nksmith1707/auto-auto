import { useEffect, useMemo, useState } from "react";
import { useColorScheme, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Archivo_700Bold, Archivo_800ExtraBold } from "@expo-google-fonts/archivo";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { createApi, DEFAULT_API_URL } from "../../../shared/api";
import { AuthProvider, useAuth } from "../../../shared/session";
import { useAuthRouting } from "../../../shared/useAuthRouting";
import { ThemeProvider, useTheme } from "../../../shared/ui";
import { makeTheme } from "../theme";
import { Splash } from "../components/Splash";

SplashScreen.preventAutoHideAsync().catch(() => {});

const api = createApi({ baseUrl: process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL });

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    Archivo_700Bold, Archivo_800ExtraBold,
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  const scheme = useColorScheme();
  const theme = useMemo(() => makeTheme(scheme), [scheme]);
  const ready = loaded || !!fontError;

  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider theme={theme}>
        <AuthProvider api={api} role="customer" wrongAppMessage="This is a partner account. Use the Auto-Auto Partner app to sign in.">
          <StatusBar style={theme.dark ? "light" : "dark"} />
          <Routes />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const PUBLIC_ROUTES = ["forgot-password", "reset-password"];

function Routes() {
  const { status } = useAuth();
  useAuthRouting(status, { signInRoute: "sign-in", publicRoutes: PUBLIC_ROUTES });
  const t = useTheme();
  // Keep the branded splash up briefly so it doesn't flash on fast connections.
  const [minTime, setMinTime] = useState(true);
  useEffect(() => { const id = setTimeout(() => setMinTime(false), 900); return () => clearTimeout(id); }, []);
  const signedIn = status === "signedIn";

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen }}>
      {status !== "loading" ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.screen }, animation: "slide_from_right" }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="home" />
            <Stack.Screen name="vehicle" />
            <Stack.Screen name="place" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="prices" />
            <Stack.Screen name="book" />
            <Stack.Screen name="job" />
            <Stack.Screen name="chat" />
            <Stack.Screen name="history" />
            <Stack.Screen name="fleet" />
            <Stack.Screen name="fleet-vehicle" />
            <Stack.Screen name="fleet-log" />
            <Stack.Screen name="fleet-request" />
            <Stack.Screen name="fleet-run" />
            <Stack.Screen name="fleet-invoice" />
            <Stack.Screen name="cards" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="reset-password" />
          </Stack.Protected>
        </Stack>
      ) : null}
      {status === "loading" || minTime ? <Splash /> : null}
    </View>
  );
}
