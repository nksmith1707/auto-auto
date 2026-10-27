import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatScreen } from "../../../shared/Chat";
import { TopBar } from "../components/TopBar";

export default function Chat() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams();
  return <ChatScreen jobId={String(id)} title={name ? `Chat with ${name}` : "Chat with your partner"} header={<TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />} />;
}
