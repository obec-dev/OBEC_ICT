"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Viewport-centered modal overlay rendered via portal to document.body.
 * Avoids mis-centering when ancestors use transform/filter (fixed containing block).
 */
export function ModalOverlay({
  children,
  onBackdropClick,
  zIndexClass = "z-[100]",
  panelMaxWidthClass = "max-w-lg",
}: {
  children: ReactNode;
  onBackdropClick?: () => void;
  zIndexClass?: string;
  panelMaxWidthClass?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm`}
      role="dialog"
      aria-modal="true"
      onClick={onBackdropClick}
    >
      <div
        className={`w-full ${panelMaxWidthClass} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
