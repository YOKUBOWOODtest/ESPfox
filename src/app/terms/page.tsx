import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/sites/whiteboardfox/placeholder-page";

export const metadata: Metadata = {
  title: "Terms of Service - Whiteboard Mod",
};

export default function TermsPage() {
  return (
    <PlaceholderPage heading="Terms of Service">
      <p>
        Whiteboard Mod is provided as-is for drawing and sharing whiteboards in
        your browser. There are no accounts and no subscriptions.
      </p>
    </PlaceholderPage>
  );
}
