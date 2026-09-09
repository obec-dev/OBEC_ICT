"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { useTheme } from "@/app/components/ThemeProvider";
import { useIctStore } from "@/contexts/IctStore";
import {
  getProjectActivityBadges,
  getProjectExamStatus,
  getProjectRegistrationStatus,
  getSiteProject,
} from "@/lib/siteSettings";
import type { LearningProject } from "@/types/ict";

const DEFAULT_GRADIENT =
  "linear-gradient(135deg, #112652 0%, #1e4d8c 55%, #2a9d8f 100%)";

function coverStyle(project: LearningProject, isDark: boolean): CSSProperties {
  if (isDark) {
    if (project.cover_url) {
      return {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.88)), url(${project.cover_url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor: "#000000",
      };
    }
    return { background: "#000000" };
  }
  if (project.cover_url) {
    return {
      backgroundImage: `linear-gradient(180deg, rgba(17,38,82,0.2), rgba(17,38,82,0.78)), url(${project.cover_url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: DEFAULT_GRADIENT };
}

function primaryHref(project: LearningProject, hasSession: boolean): string {
  if (hasSession) return "/portal/learn";
  if (getProjectRegistrationStatus(project).open) return "/register/consent";
  if (getProjectExamStatus(project).open) return "/login";
  return "/login";
}

/** Single-project homepage hero card (centered banner). */
export function ProjectCoverFlow({
  projects,
  hasSession = false,
}: {
  projects: LearningProject[];
  hasSession?: boolean;
}) {
  const { session, getExamFor } = useIctStore();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const project = useMemo(() => getSiteProject(projects), [projects]);
  if (!project || project.is_active === false) return null;

  const badges = getProjectActivityBadges(project);
  const candidate = session?.kind === "candidate" ? session.candidate : null;
  const exam = candidate ? getExamFor(candidate.id, project.id) : undefined;
  const showPassBadge =
    Boolean(hasSession) &&
    project.enable_results_visibility === true &&
    exam?.passed === true &&
    Boolean(exam.graded_at);

  return (
    <section
      className="relative z-20 mt-8 md:mt-14 mb-10 px-4 animate-fade-in-up"
      style={{ animationDelay: "0.15s", animationFillMode: "both" }}
    >
      <div className="max-w-4xl mx-auto">
        <article
          className="relative h-64 md:h-72 rounded-[2rem] overflow-hidden shadow-[0_22px_60px_rgba(17,38,82,0.22)] text-white"
          style={coverStyle(project, isDark)}
        >
          <div className="absolute inset-0 p-7 md:p-10 flex flex-col justify-between">
            <div className="flex flex-wrap gap-2">
              {showPassBadge && (
                <span className="text-[11px] md:text-xs font-extrabold bg-emerald-500 text-white border border-emerald-300/60 rounded-full px-3 py-1.5 shadow-lg">
                  ✓ ท่านผ่านการทดสอบโครงการนี้แล้ว
                </span>
              )}
              {badges.slice(0, 3).map((badge) => (
                <span
                  key={badge}
                  className="text-[11px] font-bold bg-white/20 border border-white/30 backdrop-blur-sm rounded-full px-2.5 py-1"
                >
                  {badge}
                </span>
              ))}
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-extrabold leading-snug drop-shadow">{project.name}</h2>
              {project.description && (
                <p className="text-sm md:text-base text-white/90 mt-2 max-w-2xl line-clamp-2">{project.description}</p>
              )}
              <Link
                href={primaryHref(project, hasSession)}
                className="inline-flex mt-5 rounded-full bg-white text-[var(--primary-blue)] px-6 py-2.5 text-sm font-bold hover:bg-blue-50 transition-colors"
              >
                {hasSession
                  ? "เข้าสู่โครงการ"
                  : getProjectRegistrationStatus(project).open
                    ? "ลงทะเบียน"
                    : "เข้าสู่ระบบ"}
              </Link>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
