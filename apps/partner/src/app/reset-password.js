import { useLocalSearchParams, useRouter } from "expo-router";
import { ResetPasswordForm } from "../../../shared/ResetScreens";
import { Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { p } from "../theme";

export default function ResetPassword() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const toLogin = (params) => (router.dismissTo ? router.dismissTo({ pathname: "/sign-in", params }) : router.replace({ pathname: "/sign-in", params }));
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 24 }}>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : toLogin())} title="Password help" />
      <ResetPasswordForm
        email={typeof email === "string" ? email : ""}
        onDone={() => toLogin({ notice: "reset" })}
        onBack={() => toLogin()}
      />
    </Screen>
  );
}
