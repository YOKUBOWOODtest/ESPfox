import Link from "next/link";
import { Column } from "./column";
import { WHITEBOARDMOD_NAME } from "./site-header";

export function SiteFooter() {
  return (
    <div className="bg-brand">
      <Column className="bg-brand text-white">
        <div className="px-[50px] py-[10px] text-[12px] font-[300]">
          © 2026 {WHITEBOARDMOD_NAME} &nbsp;&nbsp;·&nbsp;&nbsp;
          <Link href="/privacy" className="text-white no-underline">
            Privacy Policy
          </Link>
          &nbsp;&nbsp;·&nbsp;&nbsp;
          <Link href="/terms" className="text-white no-underline">
            Terms of Service
          </Link>
        </div>
      </Column>
    </div>
  );
}
