// Notification inbox and settings.
import { useRouter } from "expo-router";
import { NotificationsScreen } from "../../../shared/Notifications";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { p } from "../theme";

const ROUTES = ["/home", "/job", "/chat", "/claim", "/claims", "/reviews", "/payouts", "/onboarding/insurance", "/fleet-runs", "/fleet-visit"];

export default function Notifications() {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  return (
    <NotificationsScreen top={<TopBar onBack={back} title="Notifications" />} background={<HeroFade />} style={{ backgroundColor: p.bg }}
      onOpen={(d) => { if (ROUTES.includes(d.route)) router.push({ pathname: d.route, params: d.params || {} }); }} />
  );
}
