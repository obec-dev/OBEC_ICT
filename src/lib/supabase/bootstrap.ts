import { createClient } from "@/lib/supabase/client";
import { parseSiteSettings, type SitePeriodSettings } from "@/lib/siteSettings";
import type { LearningProject, SchoolTotals } from "@/types/ict";

const BOOTSTRAP_TTL_MS = 5 * 60 * 1000;

type BootstrapPayload = {
  projects: LearningProject[];
  settings: SitePeriodSettings;
  settingsRaw: Record<string, unknown>;
  schoolTotals: SchoolTotals;
  fetchedAt: number;
};

let cache: BootstrapPayload | null = null;
let inflight: Promise<BootstrapPayload> | null = null;

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asArr(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function mapTotals(raw: unknown): SchoolTotals {
  const o = asObj(raw);
  return {
    total: Number(o.total_schools) || 0,
    registered: Number(o.registered_schools) || 0,
    zones: Number(o.total_districts) || 0,
  };
}

async function loadBootstrap(): Promise<BootstrapPayload> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("public_bootstrap");
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (row.ok === false) throw new Error(String(row.error ?? "bootstrap failed"));

  const settingsRaw = asObj(row.site_settings);
  const projects = asArr(row.projects) as LearningProject[];

  return {
    projects,
    settings: parseSiteSettings(settingsRaw),
    settingsRaw,
    schoolTotals: mapTotals(row.school_totals),
    fetchedAt: Date.now(),
  };
}

/** Single RPC for projects + site_settings + school totals. Cached 5 minutes. */
export async function fetchPublicBootstrap(opts?: {
  force?: boolean;
}): Promise<BootstrapPayload> {
  const force = opts?.force === true;
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return cache;
  }
  if (!force && inflight) return inflight;

  inflight = loadBootstrap()
    .then((payload) => {
      cache = payload;
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function peekPublicBootstrapCache(): BootstrapPayload | null {
  if (!cache) return null;
  if (Date.now() - cache.fetchedAt >= BOOTSTRAP_TTL_MS) return null;
  return cache;
}

export function invalidatePublicBootstrapCache() {
  cache = null;
}

export const PUBLIC_BOOTSTRAP_TTL_MS = BOOTSTRAP_TTL_MS;
