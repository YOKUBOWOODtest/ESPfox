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
 * For GitHub Pages static export: generate a single demo board so the build succeeds.
 * For Render deployment: returns empty array to skip static generation (handled by server).
 */
export async function generateStaticParams() {
  if (process.env.GITHUB_PAGES_BUILD === "true") {
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
