import type { Metadata } from "next";
import { ProSection } from "@/components/sites/whiteboardfox/pro-section";
import { SiteShell } from "@/components/sites/whiteboardfox/site-shell";

export const metadata: Metadata = {
  title: "Activa tu pro - Whiteboard Mod",
  description:
    "Whiteboard Mod Pro es gratis: actívala con un clic, sin planes ni pasarelas de pago.",
};

export default function ProPage() {
  return (
    <SiteShell>
      <ProSection />
    </SiteShell>
  );
}
