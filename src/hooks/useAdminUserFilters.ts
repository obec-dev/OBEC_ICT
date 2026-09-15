"use client";

import { useMemo, useState } from "react";
import type { Candidate, PortalRole } from "@/types/ict";
import type { ExecutiveUserRow } from "@/lib/supabase/admin";

export type ExecutiveFilters = {
  loginId: string;
  displayName: string;
  accountType: "all" | "business" | "audit";
};

export type CandidateFilters = {
  loginEmail: string;
  name: string;
  schoolId: string;
  schoolName: string;
  districtId: string;
  province: string;
  portalRole: "all" | PortalRole;
};

export type ExamAttemptFilters = {
  loginId: string;
  name: string;
  schoolName: string;
};

const emptyExecutive: ExecutiveFilters = {
  loginId: "",
  displayName: "",
  accountType: "all",
};

const emptyCandidate: CandidateFilters = {
  loginEmail: "",
  name: "",
  schoolId: "",
  schoolName: "",
  districtId: "",
  province: "",
  portalRole: "all",
};

const emptyExam: ExamAttemptFilters = {
  loginId: "",
  name: "",
  schoolName: "",
};

function includes(hay: string | undefined | null, needle: string) {
  if (!needle.trim()) return true;
  return (hay || "").toLowerCase().includes(needle.trim().toLowerCase());
}

export function useExecutiveFilters(rows: ExecutiveUserRow[]) {
  const [filters, setFilters] = useState<ExecutiveFilters>(emptyExecutive);
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filters.accountType !== "all" && row.kind !== filters.accountType) return false;
      if (!includes(row.login_email, filters.loginId)) return false;
      if (!includes(row.display_name, filters.displayName)) return false;
      return true;
    });
  }, [filters, rows]);
  return { filters, setFilters, filtered, reset: () => setFilters(emptyExecutive) };
}

export function useCandidateFilters(rows: Candidate[]) {
  const [filters, setFilters] = useState<CandidateFilters>(emptyCandidate);
  const schoolOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (!row.school_id) continue;
      map.set(row.school_id, row.school_name || row.school_id);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [rows]);
  const districtOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (!row.district_id) continue;
      map.set(row.district_id, row.district_name || row.district_id);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [rows]);
  const provinceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.province?.trim()) set.add(row.province.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th"));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!includes(row.login_email || row.email, filters.loginEmail)) return false;
      if (!includes(row.full_name, filters.name) && !includes(`${row.first_name} ${row.last_name}`, filters.name)) {
        return false;
      }
      if (!includes(row.school_id, filters.schoolId)) return false;
      if (filters.schoolName && row.school_id !== filters.schoolName && !includes(row.school_name, filters.schoolName)) {
        return false;
      }
      if (filters.districtId && row.district_id !== filters.districtId) return false;
      if (filters.province && (row.province || "") !== filters.province) return false;
      if (filters.portalRole !== "all" && (row.portal_role || "user") !== filters.portalRole) return false;
      return true;
    });
  }, [filters, rows]);

  return {
    filters,
    setFilters,
    filtered,
    schoolOptions,
    districtOptions,
    provinceOptions,
    reset: () => setFilters(emptyCandidate),
  };
}

export function useExamAttemptFilters<T extends { login_email?: string; email?: string; full_name?: string; school_name?: string }>(
  rows: T[]
) {
  const [filters, setFilters] = useState<ExamAttemptFilters>(emptyExam);
  const schoolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.school_name?.trim()) set.add(row.school_name.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th"));
  }, [rows]);
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!includes(row.login_email || row.email, filters.loginId)) return false;
      if (!includes(row.full_name, filters.name)) return false;
      if (filters.schoolName && (row.school_name || "") !== filters.schoolName) return false;
      return true;
    });
  }, [filters, rows]);
  return { filters, setFilters, filtered, schoolOptions, reset: () => setFilters(emptyExam) };
}
