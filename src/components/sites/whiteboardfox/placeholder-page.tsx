"use client";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { Column } from "./column";

/**
 * Page for routes whose bodies were not reverse-engineered. Renders the real
 * chrome plus a short notice.
 */
export function PlaceholderPage({
  heading,
  children,
}: {
  heading: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1">
        <Column>
          <div className="px-[50px] py-[50px]">
            <h1 className="pb-[10px] text-[48px] font-[100]">{heading}</h1>
            <div className="text-[16px]" style={{ lineHeight: "160%" }}>
              {children ?? <p>This page has not been rebuilt yet.</p>}
            </div>
          </div>
        </Column>
      </div>
      <SiteFooter />
    </div>
  );
}
