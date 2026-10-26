import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black } from "@expo-google-fonts/archivo";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { createApi, DEFAULT_API_URL } from "../../../shared/api";
import { AuthProvider, useAuth } from "../../../shared/session";
import { useAuthRouting } from "../../../shared/useAuthRouting";
import { ThemeProvider } from "../../../shared/ui";
import { theme } from "../theme";
import { Splash } from "../components/Splash";

SplashScreen.preventAutoHideAsync().catch(() => {});

const api = createApi({ baseUrl: process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL });

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  const ready = loaded || !!fontError;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider theme={theme}>
        <AuthProvider api={api} role="partner" wrongAppMessage="This is a customer account. Use the Auto-Auto app to book service, or apply below to become a partner with a different email.">
          <StatusBar style="light" />
          <Routes />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const PUBLIC_ROUTES = ["apply", "forgot-password", "reset-password"];

function Routes() {
  const { status } = useAuth();
  useAuthRouting(status, { signInRoute: "sign-in", publicRoutes: PUBLIC_ROUTES });
  const [minTime, setMinTime] = useState(true);
  useEffect(() => { const id = setTimeout(() => setMinTime(false), 900); return () => clearTimeout(id); }, []);
  const signedIn = status === "signedIn";

  return (
    <View style={{ flex: 1, backgroundColor: theme.p.bg }}>
      {status !== "loading" ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.p.bg }, animation: "slide_from_right" }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="home" />
            <Stack.Screen name="service-area" />
            <Stack.Screen name="services" />
            <Stack.Screen name="job" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="apply" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="reset-password" />
          </Stack.Protected>
        </Stack>
      ) : null}
      {status === "loading" || minTime ? <Splash /> : null}
    </View>
  );
}
