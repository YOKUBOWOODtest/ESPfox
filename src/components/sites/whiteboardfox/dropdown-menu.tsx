"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Card overflow menu. Mirrors the source's `setupDropdowns()`: clicking any
 * toggle (or the document) closes every other open menu, while clicking inside
 * an open menu leaves it open.
 */
export function DropdownMenu({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div
      ref={root}
      className="dropdown absolute top-0 right-0 z-10 mt-2 mr-2 flex justify-end"
    >
      <div className="relative">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          className="dropdown-toggle text-gray-600"
          onClick={(event) => {
            // The source stops propagation on the toggle, which is why the
            // document handler closes the *other* menus but not this one.
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <div className="flex h-6 w-12 items-center justify-end">
            <svg
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
              fill="#808080"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
            </svg>
          </div>
        </button>
        <div
          className="dropdown-menu absolute top-6 right-0 z-10 w-48 overflow-hidden rounded border border-solid border-gray-200 bg-white shadow"
          style={{ display: open ? "block" : "none" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
