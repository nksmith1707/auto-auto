import { useLocalSearchParams, useRouter } from "expo-router";
import { ForgotPasswordForm } from "../../../shared/ResetScreens";
import { Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { p } from "../theme";

export default function ForgotPassword() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/sign-in"));
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 24 }}>
      <TopBar onBack={back} title="Password help" />
      <ForgotPasswordForm
        initialEmail={typeof email === "string" ? email : ""}
        onSent={(e) => router.push({ pathname: "/reset-password", params: { email: e } })}
        onBack={back}
      />
    </Screen>
  );
}
