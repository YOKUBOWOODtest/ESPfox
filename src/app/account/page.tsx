import type { Metadata } from "next";
import { AccountSection } from "@/components/sites/whiteboardfox/account-section";
import { SiteShell } from "@/components/sites/whiteboardfox/site-shell";

export const metadata: Metadata = {
  title: "Perfil - Whiteboard Mod",
  description: "Tu perfil se identifica por dispositivo. Solo puedes cambiar tu apodo.",
};

export default function AccountPage() {
  return (
    <SiteShell>
      <AccountSection />
    </SiteShell>
  );
}
