import type { Metadata } from "next";
import { StaticBoardRoute } from "@/components/sites/whiteboardfox/static-board-route";

/**
 * Static board shell used by Cloudflare Pages.
 *
 * `/board/<id>` is rewritten here by `public/_redirects`; the client reads the
 * real id from the URL. On Render the dynamic `[id]` route keeps handling
 * boards, and this page still gives `/board` a working "new board" surface.
 */
export const metadata: Metadata = {
  title: "Online Whiteboard",
  description:
    "Whiteboard Mod is a simple online whiteboard that allows you to collaborate with others in real time.",
};

export default function BoardShellPage() {
  return <StaticBoardRoute />;
}
