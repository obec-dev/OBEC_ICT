"use client";

/** Solid fill + light shade — 5 levels red → green */
function tankColors(ratio: number): { fill: string; shade: string; text: string; border: string } {
  if (ratio < 0.2) {
    return { fill: "#DC2626", shade: "#FEE2E2", text: "#991B1B", border: "#FECACA" };
  }
  if (ratio < 0.4) {
    return { fill: "#EA580C", shade: "#FFEDD5", text: "#9A3412", border: "#FED7AA" };
  }
  if (ratio < 0.6) {
    return { fill: "#CA8A04", shade: "#FEF9C3", text: "#854D0E", border: "#FDE68A" };
  }
  if (ratio < 0.8) {
    return { fill: "#65A30D", shade: "#ECFCCB", text: "#3F6212", border: "#BEF264" };
  }
  return { fill: "#0D9488", shade: "#CCFBF1", text: "#115E59", border: "#5EEAD4" };
}

type AreaHeatCardProps = {
  areaZone: string;
  total: number;
  registered: number;
  expanded: boolean;
  onToggle: () => void;
};

export function AreaHeatCard({ areaZone, total, registered, expanded, onToggle }: AreaHeatCardProps) {
  const ratio = total === 0 ? 0 : registered / total;
  const colors = tankColors(ratio);
  const pct = Math.round(ratio * 100);
  const remaining = Math.max(total - registered, 0);

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group relative w-full h-full min-h-[108px] text-left rounded-xl overflow-hidden border shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderColor: colors.border, background: colors.shade }}
      aria-pressed={expanded}
      title={`${registered}/${total} ลงทะเบียนแล้ว · เหลือ ${remaining} โรงเรียน`}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: colors.fill, opacity: 0.88 }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/5 pointer-events-none" />

      <div className="relative z-10 p-3 flex flex-col h-full justify-between gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--primary-blue)] leading-snug line-clamp-2">
            {areaZone}
          </h3>
          <div className="shrink-0 text-lg font-extrabold tabular-nums" style={{ color: colors.text }}>
            {pct}%
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-800">
            {registered}/{total} โรงเรียน
          </p>
          <p className="text-[10px] text-gray-700 mt-0.5">
            {remaining > 0 ? `ยังขาดอีก ${remaining} โรงเรียน` : "ครบทุกโรงเรียนแล้ว"}
            {" · "}
            {expanded ? "ย่อรายชื่อ" : "ดูรายชื่อ"}
          </p>
        </div>
      </div>
    </button>
  );
}
