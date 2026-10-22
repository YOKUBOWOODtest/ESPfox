import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/sites/whiteboardfox/placeholder-page";

export const metadata: Metadata = {
  title: "Privacy Policy - Whiteboard Mod",
};

export default function PrivacyPage() {
  return (
    <PlaceholderPage heading="Privacy Policy">
      <p>
        Whiteboard Mod keeps everything on your device: your nickname, your
        device id and any whiteboards you open are stored in this browser only.
        Nothing is uploaded to a server.
      </p>
    </PlaceholderPage>
  );
}
