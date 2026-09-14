import type { ExecutiveTrendPoint } from "@/lib/supabase/data";

export function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export function weekLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export function Kpi({
  label,
  value,
  hint,
  accent = "blue",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "red" | "green" | "amber";
}) {
  const tone =
    accent === "red"
      ? "text-[var(--accent-red)]"
      : accent === "green"
        ? "text-emerald-700 dark:text-emerald-300"
        : accent === "amber"
          ? "text-amber-700 dark:text-amber-300"
          : "text-[var(--primary-blue)] dark:text-white";
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-4">
      <div className={`text-2xl md:text-3xl font-extrabold tabular-nums ${tone}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-sm font-semibold mt-1 text-gray-700 dark:text-white">{label}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

export function Meter({ label, value, total, tone = "blue" }: { label: string; value: number; total: number; tone?: "blue" | "green" | "amber" }) {
  const ratio = pct(value, total);
  const bar = tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-[var(--primary-blue)]";
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-gray-600 dark:text-white/80 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">
          {value.toLocaleString()} · {ratio}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

export function TrendChart({
  points,
  series,
}: {
  points: ExecutiveTrendPoint[];
  series: { key: keyof ExecutiveTrendPoint; label: string; className: string }[];
}) {
  const max = Math.max(
    1,
    ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0))
  );
  return (
    <div>
      <div className="flex flex-wrap gap-3 text-xs font-semibold mb-3">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-gray-600 dark:text-white/80">
            <span className={`size-2.5 rounded-sm ${s.className}`} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-2 items-end h-36">
        {points.map((p) => (
          <div key={p.week_start} className="flex flex-col items-center gap-1 h-full justify-end">
            <div className="flex items-end gap-0.5 h-28 w-full justify-center">
              {series.map((s) => {
                const n = Number(p[s.key]) || 0;
                return (
                  <div
                    key={s.label}
                    title={`${s.label}: ${n}`}
                    className={`w-1.5 md:w-2 rounded-t ${s.className}`}
                    style={{ height: `${Math.max(4, (n / max) * 100)}%` }}
                  />
                );
              })}
            </div>
            <span className="text-[10px] text-gray-400 truncate w-full text-center">{weekLabel(p.week_start)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
