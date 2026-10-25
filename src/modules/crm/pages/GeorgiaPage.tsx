import { AppLayout } from "@/shared/components/AppLayout";
import { EaChat } from "../components/EaChat";

/** Georgia on her own page: on a phone the chat has no room beside Today, so it gets the whole screen. */
export default function GeorgiaPage() {
  return <AppLayout><EaChat fill /></AppLayout>;
}
