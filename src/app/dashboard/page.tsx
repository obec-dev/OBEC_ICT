"use client";

import { useEffect, useMemo, useState } from "react";
import { AreaHeatCard } from "@/app/components/AreaHeatCard";
import { SchoolStatusList } from "@/app/components/SchoolStatusList";
import { SearchFilterBar } from "@/app/components/SearchFilterBar";
import { useIctStore } from "@/contexts/IctStore";
import { fetchSchoolsByDistrict, searchSchoolsByName } from "@/lib/supabase/data";
import type { DistrictStat, School } from "@/types/ict";

export default function DashboardPage() {
  const { districtStats, schoolTotals, loading, loadError, refreshData } = useIctStore();
  const [schoolQuery, setSchoolQuery] = useState("");
  const [areaZone, setAreaZone] = useState("");
  const [province, setProvince] = useState("");
  const [sortBy, setSortBy] = useState<"percent" | "name" | "schools">("percent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSchools, setExpandedSchools] = useState<School[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [searchHits, setSearchHits] = useState<School[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const areaOptions = useMemo(
    () => [...new Set(districtStats.map((d) => d.district_name))].sort((a, b) => a.localeCompare(b, "th")),
    [districtStats]
  );
  const provinceOptions = useMemo(
    () =>
      [...new Set(districtStats.map((d) => d.province).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "th")
      ),
    [districtStats]
  );

  const filteredStats = useMemo(() => {
    const list = districtStats.filter((d) => {
      if (areaZone && d.district_name !== areaZone) return false;
      if (province && d.province !== province) return false;
      if (schoolQuery.trim() && searchHits.length > 0) {
        const hitDistricts = new Set(searchHits.map((s) => s.district_id).filter(Boolean));
        if (!hitDistricts.has(d.district_id)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortBy === "name") {
        return a.district_name.localeCompare(b.district_name, "th") * dir;
      }
      if (sortBy === "schools") {
        return (a.total_schools - b.total_schools) * dir;
      }
      const pa = a.total_schools === 0 ? 0 : a.registered_schools / a.total_schools;
      const pb = b.total_schools === 0 ? 0 : b.registered_schools / b.total_schools;
      if (pa === pb) return a.district_name.localeCompare(b.district_name, "th");
      return (pa - pb) * dir;
    });
  }, [areaZone, districtStats, province, schoolQuery, searchHits, sortBy, sortDir]);

  useEffect(() => {
    const q = schoolQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void searchSchoolsByName(q, 80)
        .then((rows) => {
          if (!cancelled) setSearchHits(rows);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [schoolQuery]);

  const toggleDistrict = async (stat: DistrictStat) => {
    if (expandedId === stat.district_id) {
      setExpandedId(null);
      setExpandedSchools([]);
      setExpandError(null);
      return;
    }

    setExpandedId(stat.district_id);
    setExpandLoading(true);
    setExpandError(null);
    setExpandedSchools([]);

    try {
      const schools = await fetchSchoolsByDistrict(stat.district_id);
      setExpandedSchools(schools);
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "โหลดรายชื่อโรงเรียนไม่สำเร็จ");
    } finally {
      setExpandLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold text-[var(--primary-blue)]">ภาพรวมการลงทะเบียน</h1>
        <p className="text-gray-500 mt-2">
          ดูสัดส่วนโรงเรียนที่ลงทะเบียนในแต่ละเขตพื้นที่การศึกษา
          {!loading && schoolTotals.total > 0 && (
            <span className="text-gray-400">
              {" "}
              · สรุป {schoolTotals.zones.toLocaleString()} เขต / {schoolTotals.total.toLocaleString()}{" "}
              โรงเรียน
            </span>
          )}
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>
            โหลดสรุปเขตไม่สำเร็จ: {loadError}
            <span className="block text-xs mt-1 opacity-80">
              หากยังไม่ได้รัน RPC ให้ไปที่ Supabase SQL Editor แล้วรันไฟล์{" "}
              <code>supabase/dashboard_stats.sql</code>
            </span>
          </span>
          <button type="button" onClick={() => void refreshData()} className="shrink-0 font-bold underline">
            ลองใหม่
          </button>
        </div>
      )}

      {loading && (
        <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-[var(--primary-blue)]">
          กำลังโหลดสรุปเขตพื้นที่ (ข้อมูลเบา ไม่ดึงโรงเรียนทั้งหมด)...
        </div>
      )}

      <SearchFilterBar
        schoolQuery={schoolQuery}
        areaZone={areaZone}
        province={province}
        areaOptions={areaOptions}
        provinceOptions={provinceOptions}
        onSchoolQueryChange={setSchoolQuery}
        onAreaZoneChange={setAreaZone}
        onProvinceChange={setProvince}
      />
      {searchLoading && (
        <p className="mt-2 text-xs text-gray-500">กำลังค้นหาชื่อโรงเรียน...</p>
      )}

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="text-sm font-semibold text-[var(--primary-blue)]">เรียงลำดับ</label>
        <select
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "percent" | "name" | "schools")}
        >
          <option value="percent">% ลงทะเบียน</option>
          <option value="name">ชื่อเขตพื้นที่</option>
          <option value="schools">จำนวนโรงเรียน</option>
        </select>
        <select
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
          value={sortDir}
          onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
        >
          <option value="asc">{sortBy === "name" ? "ก → ฮ" : "น้อย → มาก"}</option>
          <option value="desc">{sortBy === "name" ? "ฮ → ก" : "มาก → น้อย"}</option>
        </select>
      </div>

      
        <div className="mt-2 mb-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
          {/*  <span className="font-medium text-gray-600">ระดับความคืบหน้า:</span>
          {[
            { label: "0–19%", color: "#DC2626" },
            { label: "20–39%", color: "#EA580C" },
            { label: "40–59%", color: "#CA8A04" },
            { label: "60–79%", color: "#65A30D" },
            { label: "80–100%", color: "#0D9488" },
          ].map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: item.color }} />
              {item.label}
            </span>
          ))} */}
        </div> 
      

      <div className="mt-2">
        {loading && districtStats.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-gray-500 border border-gray-100">
            กำลังโหลดข้อมูล...
          </div>
        ) : filteredStats.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-gray-500 border border-gray-100">
            ไม่พบเขตพื้นที่ตามเงื่อนไขที่เลือก
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {filteredStats.map((stat) => {
              const isOpen = expandedId === stat.district_id;
              return (
                <div key={stat.district_id} className="contents">
                  <AreaHeatCard
                    areaZone={stat.district_name}
                    total={stat.total_schools}
                    registered={stat.registered_schools}
                    expanded={isOpen}
                    onToggle={() => void toggleDistrict(stat)}
                  />
                  {isOpen && (
                    <div className="col-span-2 md:col-span-4">
                      {expandLoading ? (
                        <div className="mt-1 rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">
                          กำลังโหลดรายชื่อโรงเรียนในเขตนี้...
                        </div>
                      ) : expandError ? (
                        <div className="mt-1 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                          {expandError}
                        </div>
                      ) : (
                        <SchoolStatusList schools={expandedSchools} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
