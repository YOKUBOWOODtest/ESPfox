import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * Shared page frame: gray header strip, content, then the blue footer pinned to
 * the bottom of the viewport when the page is short (`min-height: 100vh` +
 * `flex-grow` spacer, mirroring the source).
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
