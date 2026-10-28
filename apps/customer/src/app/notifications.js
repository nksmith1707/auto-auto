// Notification inbox and settings.
import { useRouter } from "expo-router";
import { NotificationsScreen } from "../../../shared/Notifications";
import { TopBar } from "../components/TopBar";

const ROUTES = ["/job", "/chat", "/claim", "/fleet", "/fleet-run", "/fleet-invoice", "/home"];

export default function Notifications() {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  return (
    <NotificationsScreen top={<TopBar onBack={back} />}
      onOpen={(d) => { if (ROUTES.includes(d.route)) router.push({ pathname: d.route, params: d.params || {} }); }} />
  );
}
