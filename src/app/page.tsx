import type { Metadata } from "next";
import { Contact } from "@/components/sites/whiteboardfox/contact";
import { Features } from "@/components/sites/whiteboardfox/features";
import { Hero } from "@/components/sites/whiteboardfox/hero";
import { SiteShell } from "@/components/sites/whiteboardfox/site-shell";

export const metadata: Metadata = {
  title: "Simple Online Whiteboard - Whiteboard Mod",
  description:
    "Whiteboard Mod is a simple online whiteboard that allows you to collaborate with others in real time. Share your ideas, brainstorm with your team, and take notes all in one place. Whiteboard Mod is easy to use, and it's free to get started.",
};

export default function Home() {
  return (
    <SiteShell>
      <Hero />
      <Features />
      <Contact />
    </SiteShell>
  );
}
