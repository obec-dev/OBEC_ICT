"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalOverlay } from "@/app/components/ModalOverlay";

type UnsavedLeaveGuardProps = {
  isDirty: boolean;
  /** Save current draft to store/DB */
  onSave: () => void | Promise<void>;
  /** Discard current draft; keep last saved state */
  onDiscard: () => void | Promise<void>;
  title?: string;
  description?: string;
};

/**
 * Intercepts in-app link navigation when dirty.
 * Yes → save then leave. No → discard current (keep last saved) then leave.
 * Browser tab close uses native beforeunload (cannot customize Yes/No save there).
 */
export function UnsavedLeaveGuard({
  isDirty,
  onSave,
  onDiscard,
  title = "บันทึกสถานะก่อนออกจากหน้า?",
  description = "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก หากกด “บันทึก” จะส่งสถานะปัจจุบันไปยังเซิร์ฟเวอร์ หากกด “ไม่บันทึก” จะคงสถานะล่าสุดที่บันทึกไว้ก่อนหน้า",
}: UnsavedLeaveGuardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
      setOpen(true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const leaveTo = (href: string | null) => {
    if (!href) return;
    router.push(href);
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave();
      setOpen(false);
      const href = pendingHref;
      setPendingHref(null);
      leaveTo(href);
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    try {
      await onDiscard();
      setOpen(false);
      const href = pendingHref;
      setPendingHref(null);
      leaveTo(href);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setPendingHref(null);
  };

  if (!open) return null;

  return (
    <ModalOverlay zIndexClass="z-[200]" onBackdropClick={handleCancel}>
      <div className="bg-white rounded-2xl p-7 shadow-2xl border border-gray-100 mx-auto max-w-md">
        <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-3">{title}</h3>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">{description}</p>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            disabled={busy}
            className="px-5 py-2.5 rounded-full border border-gray-300 text-gray-700 font-semibold disabled:opacity-40"
            onClick={handleCancel}
          >
            อยู่หน้านี้ต่อ
          </button>
          <button
            type="button"
            disabled={busy}
            className="px-5 py-2.5 rounded-full border border-[var(--accent-red)] text-[var(--accent-red)] font-bold disabled:opacity-40"
            onClick={() => void handleDiscard()}
          >
            ไม่บันทึก
          </button>
          <button
            type="button"
            disabled={busy}
            className="px-5 py-2.5 rounded-full bg-[var(--primary-blue)] text-white font-bold disabled:opacity-40"
            onClick={() => void handleSave()}
          >
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
