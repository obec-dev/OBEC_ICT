"use client";

import {
  formatScheduleDate,
  getProjectExamStatus,
  getProjectRegistrationStatus,
  getSiteProject,
  hasScheduleDate,
} from "@/lib/siteSettings";
import type { LearningProject } from "@/types/ict";

function TimelineItem({
  label,
  start,
  end,
  statusLabel,
}: {
  label: string;
  start?: string | null;
  end?: string | null;
  statusLabel: string;
}) {
  return (
    <div className="relative pl-8 pb-8 last:pb-0">
      <span className="absolute left-0 top-1.5 w-3 h-3 rounded-full bg-[var(--primary-blue)] ring-4 ring-blue-100" />
      <div className="absolute left-[5px] top-5 bottom-0 w-px bg-blue-100 last:hidden" />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
        <h3 className="font-extrabold text-gray-900">{label}</h3>
        <span className="text-xs font-bold text-[var(--primary-blue)] bg-blue-50 border border-blue-100 rounded-full px-2.5 py-0.5">
          {statusLabel}
        </span>
      </div>
      <p className="text-sm text-gray-600">
        {hasScheduleDate(start) || hasScheduleDate(end) ? (
          <>
            <span className="font-semibold text-gray-800">{formatScheduleDate(start)}</span>
            <span className="mx-2 text-gray-400">→</span>
            <span className="font-semibold text-gray-800">{formatScheduleDate(end)}</span>
          </>
        ) : (
          <span className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">
            ยังไม่กำหนดวัน
          </span>
        )}
      </p>
    </div>
  );
}

/** Minimal inline timeline for the single site project (no cards). */
export function ProjectScheduleNotice({ projects }: { projects: LearningProject[] }) {
  const project = getSiteProject(projects);
  if (!project || project.is_active === false) return null;

  const reg = getProjectRegistrationStatus(project);
  const exam = getProjectExamStatus(project);

  return (
    <section className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-[var(--primary-blue)] mb-2">กำหนดการโครงการ</h2>
        <p className="text-gray-500 text-sm">{project.name}</p>
      </div>

      <div className="relative">
        <TimelineItem
          label="ลงทะเบียน"
          start={project.reg_start}
          end={project.reg_end}
          statusLabel={reg.message}
        />
        <TimelineItem
          label="สอบคัดเลือก"
          start={project.exam_start}
          end={project.exam_end}
          statusLabel={exam.message}
        />
      </div>
    </section>
  );
}
