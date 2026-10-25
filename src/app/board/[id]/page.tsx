import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardSection } from "@/components/sites/whiteboardfox/board-section";

/**
 * Whiteboard surface.
 *
 * The source renders the board without the marketing chrome — it is a
 * full-viewport application — so this route deliberately skips `SiteShell`.
 * The title follows the source's pattern, `Whiteboard <id>`.
 */
export const metadata: Metadata = {
  title: "Online Whiteboard",
  description:
    "Whiteboard Mod is a simple online whiteboard that allows you to collaborate with others in real time.",
};

/**
 * Static export needs at least one concrete board path. Cloudflare Pages
 * rewrites every `/board/<id>` to the static `/board/` shell, which reads the
 * real id from the browser URL; the demo page is only what makes the export
 * build. Render returns no params and handles any id dynamically.
 */
export async function generateStaticParams() {
  if (process.env.STATIC_EXPORT === "true" || process.env.GITHUB_PAGES_BUILD === "true") {
    return [{ id: "demo" }];
  }
  return [];
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boardId = decodeURIComponent(id).trim();

  if (!boardId) {
    notFound();
  }

  return <BoardSection boardId={boardId} />;
}
