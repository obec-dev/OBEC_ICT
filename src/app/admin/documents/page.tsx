"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { Combobox } from "@/app/components/Combobox";
import { useIctStore } from "@/contexts/IctStore";
import { normalizeExternalUrl } from "@/lib/url";
import {
  adminDeleteAuditorDocument,
  adminListAuditorDocuments,
  adminUpsertAuditorDocument,
} from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/client";
import { inputClass } from "@/lib/styles";

type DocRow = Awaited<ReturnType<typeof adminListAuditorDocuments>>[number];

function DocumentsContent() {
  const { adminToken } = useIctStore();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [districts, setDistricts] = useState<{ district_id: string; district_name: string }[]>([]);
  const [docDraft, setDocDraft] = useState({
    id: "",
    district_ids: [] as string[],
    title: "",
    file_url: "",
  });
  const [docAddDistrict, setDocAddDistrict] = useState("");
  const [docExcludeDistrict, setDocExcludeDistrict] = useState("");
  const [docFilterDistrict, setDocFilterDistrict] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const districtOptions = useMemo(
    () => districts.map((d) => ({ value: d.district_id, label: d.district_name })),
    [districts]
  );
  const districtNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of districts) map.set(d.district_id, d.district_name);
    return map;
  }, [districts]);
  const allDistrictIds = useMemo(() => districts.map((d) => d.district_id), [districts]);
  const filteredDocs = useMemo(
    () =>
      docFilterDistrict
        ? docs.filter((d) => {
            const ids = d.district_ids?.length ? d.district_ids : d.district_id ? [d.district_id] : [];
            return ids.includes(docFilterDistrict);
          })
        : docs,
    [docs, docFilterDistrict]
  );

  const docExcludedIds = useMemo(() => {
    if (!allDistrictIds.length || !docDraft.district_ids.length) return [] as string[];
    if (docDraft.district_ids.length < allDistrictIds.length * 0.5) return [] as string[];
    const selected = new Set(docDraft.district_ids);
    return allDistrictIds.filter((id) => !selected.has(id));
  }, [allDistrictIds, docDraft.district_ids]);

  const docSelectionMode = useMemo(() => {
    const n = docDraft.district_ids.length;
    const total = allDistrictIds.length;
    if (!n) return "empty" as const;
    if (total > 0 && n === total) return "all" as const;
    if (total > 0 && docExcludedIds.length > 0 && docExcludedIds.length <= 8 && n >= total - 8) {
      return "near_all" as const;
    }
    if (n > 12) return "many" as const;
    return "sparse" as const;
  }, [docDraft.district_ids.length, allDistrictIds.length, docExcludedIds]);

  const formatDocDistrictsLabel = useCallback(
    (ids: string[]) => {
      const total = allDistrictIds.length;
      if (!ids.length) return "— ไม่มีเขต —";
      if (total > 0 && ids.length === total) return `ทุกเขต (${total})`;
      const selected = new Set(ids);
      const excluded = allDistrictIds.filter((id) => !selected.has(id));
      if (total > 0 && excluded.length > 0 && excluded.length <= 3 && ids.length > total - 4) {
        return `ทุกเขต ยกเว้น ${excluded.map((id) => districtNameById.get(id) || id).join(", ")}`;
      }
      if (ids.length <= 3) {
        return ids.map((id) => districtNameById.get(id) || id).join(", ");
      }
      return `${ids.length} เขต`;
    },
    [allDistrictIds, districtNameById]
  );

  const reload = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError("");
    try {
      setDocs(await adminListAuditorDocuments(adminToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("districts")
      .select("district_id, district_name")
      .order("district_name")
      .then(({ data }) => {
        setDistricts(
          (data ?? []).map((r) => ({
            district_id: String(r.district_id),
            district_name: String(r.district_name ?? r.district_id),
          }))
        );
      });
  }, []);

  const resetDocDraft = () => {
    setDocDraft({ id: "", district_ids: [], title: "", file_url: "" });
    setDocAddDistrict("");
    setDocExcludeDistrict("");
  };

  const saveDoc = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    if (!docDraft.district_ids.length) {
      setError("กรุณาเลือกอย่างน้อย 1 เขต");
      return;
    }
    if (!docDraft.title.trim()) {
      setError("กรุณาระบุชื่อเอกสาร");
      return;
    }
    const result = await adminUpsertAuditorDocument(adminToken, {
      id: docDraft.id || undefined,
      district_ids: docDraft.district_ids,
      title: docDraft.title,
      file_url: normalizeExternalUrl(docDraft.file_url) || docDraft.file_url,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(docDraft.id ? "แก้ไขเอกสารแล้ว" : "บันทึกเอกสารแล้ว");
    resetDocDraft();
    await reload();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">เอกสาร</h1>
      <p className="text-gray-500 mb-6">
        มอบเอกสารให้เขตที่แท็กไว้
      </p>

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-3">{message}</p>}
      {loading && <p className="text-sm text-gray-500 mb-3">กำลังโหลด...</p>}

      <div className="space-y-6">
        <div className="bg-white rounded-2xl border p-6 space-y-3">
          <h2 className="font-bold text-[var(--primary-blue)]">
            {docDraft.id ? "แก้ไขเอกสาร" : "เพิ่มเอกสาร"}
          </h2>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-semibold text-[var(--primary-blue)]">
                เขตที่เข้าถึงเอกสาร (หลายเขต)
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-[var(--primary-blue)]"
                  onClick={() => setDocDraft((d) => ({ ...d, district_ids: [...allDistrictIds] }))}
                  disabled={!allDistrictIds.length}
                >
                  เลือกทั้งหมด
                </button>
                <button
                  type="button"
                  className="rounded-full border px-3 py-1.5 text-xs font-bold text-gray-600"
                  onClick={() => setDocDraft((d) => ({ ...d, district_ids: [] }))}
                >
                  ล้างทั้งหมด
                </button>
              </div>
            </div>

            {docSelectionMode === "all" && (
              <p className="text-sm font-semibold text-emerald-700">
                ทุกเขต ({allDistrictIds.length})
              </p>
            )}

            {docSelectionMode === "near_all" && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-amber-800">
                  ทุกเขต ยกเว้น {docExcludedIds.length} เขต
                </p>
                <div className="flex flex-wrap gap-2">
                  {docExcludedIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      title="คลิกเพื่อคืนเข้ารายการ"
                      className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900"
                      onClick={() =>
                        setDocDraft((d) => ({
                          ...d,
                          district_ids: d.district_ids.includes(id)
                            ? d.district_ids
                            : [...d.district_ids, id],
                        }))
                      }
                    >
                      ยกเว้น {districtNameById.get(id) || id} ×
                    </button>
                  ))}
                </div>
              </div>
            )}

            {docSelectionMode === "sparse" && (
              <div className="flex flex-wrap gap-2">
                {docDraft.district_ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    title="คลิกเพื่อลบ"
                    className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs"
                    onClick={() =>
                      setDocDraft((d) => ({
                        ...d,
                        district_ids: d.district_ids.filter((x) => x !== id),
                      }))
                    }
                  >
                    {districtNameById.get(id) || id} ×
                  </button>
                ))}
              </div>
            )}

            {docSelectionMode === "many" && (
              <p className="text-sm font-semibold text-gray-700">
                เลือกแล้ว {docDraft.district_ids.length} เขต — ใช้ “ยกเว้นเขต” หรือ “ล้างทั้งหมด”
              </p>
            )}

            {docSelectionMode === "empty" && (
              <span className="text-xs text-gray-400">ยังไม่ได้เลือกเขต</span>
            )}

            {(docSelectionMode === "all" ||
              docSelectionMode === "near_all" ||
              docSelectionMode === "many") && (
              <Combobox
                label="ยกเว้นเขต"
                value={docExcludeDistrict}
                options={districtOptions.filter((o) => docDraft.district_ids.includes(o.value))}
                placeholder="ค้นหาเขตที่จะยกเว้น"
                allLabel="— เลือกเขตยกเว้น —"
                onChange={(v) => {
                  setDocExcludeDistrict("");
                  if (!v) return;
                  setDocDraft((d) => ({
                    ...d,
                    district_ids: d.district_ids.filter((x) => x !== v),
                  }));
                }}
              />
            )}

            {(docSelectionMode === "empty" ||
              docSelectionMode === "sparse" ||
              docSelectionMode === "many") && (
              <Combobox
                label="เพิ่มเขต"
                value={docAddDistrict}
                options={districtOptions.filter((o) => !docDraft.district_ids.includes(o.value))}
                placeholder="ค้นหา / เลือกเขต"
                allLabel="— เลือกเขต —"
                onChange={(v) => {
                  setDocAddDistrict("");
                  if (!v) return;
                  setDocDraft((d) => ({
                    ...d,
                    district_ids: d.district_ids.includes(v)
                      ? d.district_ids
                      : [...d.district_ids, v],
                  }));
                }}
              />
            )}
          </div>
          <input
            className={inputClass}
            placeholder="ชื่อเอกสาร"
            value={docDraft.title}
            onChange={(e) => setDocDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            className={inputClass}
            placeholder="URL ไฟล์เอกสาร"
            value={docDraft.file_url}
            onChange={(e) => setDocDraft((d) => ({ ...d, file_url: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveDoc()}
              className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold"
            >
              {docDraft.id ? "บันทึกการแก้ไข" : "บันทึกเอกสาร"}
            </button>
            {(docDraft.id ||
              docDraft.district_ids.length > 0 ||
              docDraft.title ||
              docDraft.file_url) && (
              <button
                type="button"
                className="rounded-full border px-5 py-2.5 font-bold"
                onClick={resetDocDraft}
              >
                ยกเลิก
              </button>
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl border p-4 space-y-3">
          <Combobox
            label="กรองรายการตามเขต"
            value={docFilterDistrict}
            options={districtOptions}
            placeholder="ทุกเขต"
            allLabel="ทุกเขต"
            onChange={setDocFilterDistrict}
          />
          <div className="divide-y border rounded-xl">
            {filteredDocs.map((d) => {
              const ids = d.district_ids?.length
                ? d.district_ids
                : d.district_id
                  ? [d.district_id]
                  : [];
              return (
                <div key={d.id} className="p-4 flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-bold">{d.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatDocDistrictsLabel(ids)}
                    </div>
                    {d.file_url && (
                      <a
                        href={normalizeExternalUrl(d.file_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-[var(--primary-blue)] break-all"
                      >
                        {d.file_url}
                      </a>
                    )}
                  </div>
                  <div className="flex gap-3 items-start">
                    <button
                      type="button"
                      className="text-sm font-bold text-[var(--primary-blue)]"
                      onClick={() => {
                        setDocDraft({
                          id: d.id,
                          district_ids: [...ids],
                          title: d.title,
                          file_url: d.file_url || "",
                        });
                        setDocAddDistrict("");
                        setDocExcludeDistrict("");
                      }}
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="text-sm font-bold text-[var(--accent-red)]"
                      onClick={() => {
                        if (!adminToken || !confirm("ลบ?")) return;
                        void adminDeleteAuditorDocument(adminToken, d.id).then(() => reload());
                      }}
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              );
            })}
            {!filteredDocs.length && (
              <p className="p-4 text-sm text-gray-500">ยังไม่มีเอกสาร</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminDocumentsPage() {
  return (
    <AuthGuard requireAdmin>
      <DocumentsContent />
    </AuthGuard>
  );
}
