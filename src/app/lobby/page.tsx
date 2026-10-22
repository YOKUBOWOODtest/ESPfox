import type { Metadata } from "next";
import { Suspense } from "react";
import { LobbySection } from "@/components/sites/whiteboardfox/lobby-section";
import { SiteShell } from "@/components/sites/whiteboardfox/site-shell";

export const metadata: Metadata = {
  title: "Lobby - Whiteboard Mod",
  description:
    "Elige tu apodo: te identificamos por dispositivo, sin cuentas ni inicio de sesión.",
};

export default function LobbyPage() {
  return (
    <SiteShell>
      {/* `useSearchParams` needs a Suspense boundary to stay prerenderable. */}
      <Suspense
        fallback={
          <div className="px-[50px] py-[50px] text-[18px]">Cargando lobby…</div>
        }
      >
        <LobbySection />
      </Suspense>
    </SiteShell>
  );
}
