"use client";

type TablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function TablePagination({ page, pageSize, total, onPageChange }: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const disabled = total === 0;

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped !== current) onPageChange(clamped);
  };

  const btn =
    "rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-black px-3 py-1.5 text-xs font-bold text-[var(--primary-blue)] dark:text-white disabled:opacity-35";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
      <button type="button" className={btn} disabled={disabled || current <= 1} onClick={() => go(1)}>
        ≪ หน้าแรก
      </button>
      <button
        type="button"
        className={btn}
        disabled={disabled || current <= 1}
        onClick={() => go(current - 1)}
      >
        &lt; ย้อนกลับ
      </button>
      <span className="text-xs font-semibold text-gray-600 dark:text-white/80 px-2">
        หน้า {disabled ? 0 : current} จาก {disabled ? 0 : totalPages}
      </span>
      <button
        type="button"
        className={btn}
        disabled={disabled || current >= totalPages}
        onClick={() => go(current + 1)}
      >
        ถัดไป &gt;
      </button>
      <button
        type="button"
        className={btn}
        disabled={disabled || current >= totalPages}
        onClick={() => go(totalPages)}
      >
        หน้าสุดท้าย ≫
      </button>
    </div>
  );
}

export function paginateSlice<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
