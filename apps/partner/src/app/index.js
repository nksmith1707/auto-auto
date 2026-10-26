// The app opens at "/". Send people to home or log in, so the first screen never depends on route order.
import { Redirect } from "expo-router";
import { useAuth } from "../../../shared/session";

export default function Index() {
  const { status } = useAuth();
  if (status === "loading") return null;
  return <Redirect href={status === "signedIn" ? "/home" : "/sign-in"} />;
}
