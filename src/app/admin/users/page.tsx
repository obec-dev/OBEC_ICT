"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminListExecutiveUsers,
  adminResetExecutiveTempPasswordRpc,
  adminRestoreExecutiveRpc,
  adminRestoreUserRpc,
  adminSearchUsers,
  adminSetAuditDistrictsRpc,
  adminSetExecutiveActiveRpc,
  adminSetPortalRoleRpc,
  adminSetUserActiveRpc,
  adminSoftDeleteExecutiveRpc,
  adminSoftDeleteUserRpc,
  adminUpdateLoginEmailRpc,
  adminUpsertAuditUserRpc,
  adminUpsertBusinessUserRpc,
  generateTempPassword,
  type ExecutiveUserRow,
} from "@/lib/supabase/admin";
import { Combobox } from "@/app/components/Combobox";
import { TablePagination, paginateSlice } from "@/app/components/TablePagination";
import { useCandidateFilters, useExecutiveFilters } from "@/hooks/useAdminUserFilters";
import { fetchDistrictStats } from "@/lib/supabase/data";
import { inputClass } from "@/lib/styles";
import type { Candidate, PortalRole } from "@/types/ict";

const ROLE_LABELS: Record<PortalRole, string> = {
  user: "user",
  school_admin: "school_admin",
};

const PAGE_SIZE = 10;

function UsersContent() {
  const { adminToken, districtStats } = useIctStore();
  const [districtCatalog, setDistrictCatalog] = useState(districtStats);
  const [activeTab, setActiveTab] = useState<"candidates" | "executives">("candidates");
  const [users, setUsers] = useState<Candidate[]>([]);
  const [executives, setExecutives] = useState<{
    business: ExecutiveUserRow[];
    audit: ExecutiveUserRow[];
  }>({ business: [], audit: [] });
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [emailEditId, setEmailEditId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [roleEditId, setRoleEditId] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<PortalRole>("user");

  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<"business" | "audit">("business");
  const [createForm, setCreateForm] = useState({
    login_email: "",
    display_name: "",
    position: "",
  });
  const [districtPick, setDistrictPick] = useState("");
  const [districtBasket, setDistrictBasket] = useState<string[]>([]);
  const [auditEditId, setAuditEditId] = useState<string | null>(null);
  const [auditBasket, setAuditBasket] = useState<string[]>([]);
  const [auditPick, setAuditPick] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [execPage, setExecPage] = useState(1);

  useEffect(() => {
    if (districtStats.length > 0) {
      setDistrictCatalog(districtStats);
      return;
    }
    void fetchDistrictStats()
      .then(setDistrictCatalog)
      .catch(() => setDistrictCatalog([]));
  }, [districtStats]);

  const search = async () => {
    if (!adminToken) return;
    setLoading(true);
    setError("");
    try {
      const [rows, exec] = await Promise.all([
        adminSearchUsers(adminToken, "", 100, includeDeleted),
        adminListExecutiveUsers(adminToken, includeDeleted),
      ]);
      setUsers(rows);
      setExecutives(exec);
      setUserPage(1);
      setExecPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  // Initial load only — client filters apply to this cached set; Search reloads from server.
  useEffect(() => {
    if (!adminToken) return;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError("");
    setMessage("");
    try {
      await fn();
      await search();
    } finally {
      setBusyId(null);
    }
  };

  const saveEmail = (u: Candidate) =>
    withBusy(u.id, async () => {
      if (!adminToken) return;
      const res = await adminUpdateLoginEmailRpc(adminToken, u.id, emailDraft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("อัปเดต Login ID แล้ว (contact_email ไม่เปลี่ยน)");
      setEmailEditId(null);
    });

  const saveRole = (u: Candidate) =>
    withBusy(u.id, async () => {
      if (!adminToken) return;
      const res = await adminSetPortalRoleRpc(adminToken, u.id, roleDraft, null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("อัปเดตบทบาทแล้ว");
      setRoleEditId(null);
    });

  const toggleActive = (u: Candidate) =>
    withBusy(u.id, async () => {
      if (!adminToken) return;
      const next = !(u.is_active !== false);
      const res = await adminSetUserActiveRpc(adminToken, u.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(next ? "เปิดใช้งานบัญชีแล้ว" : "ระงับบัญชีแล้ว");
    });

  const softDelete = (u: Candidate) =>
    withBusy(u.id, async () => {
      if (!adminToken) return;
      if (!confirm(`ลบผู้ใช้ ${u.full_name || u.id} แบบ soft-delete (กู้คืนได้ภายใน 30 วัน)?`)) return;
      const res = await adminSoftDeleteUserRpc(adminToken, u.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("ลบบัญชีแล้ว (เก็บไว้ 30 วัน)");
    });

  const restore = (u: Candidate) =>
    withBusy(u.id, async () => {
      if (!adminToken) return;
      const res = await adminRestoreUserRpc(adminToken, u.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("กู้คืนบัญชีแล้ว");
    });

  const createSpecial = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    const temp = generateTempPassword();
    let createdTemp = temp;
    if (createKind === "business") {
      const res = await adminUpsertBusinessUserRpc(adminToken, {
        login_email: createForm.login_email,
        display_name: createForm.display_name,
        position: createForm.position,
        temp_password: temp,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      createdTemp = res.temp_password || temp;
      setMessage(`สร้าง business_user แล้ว — รหัสผ่านชั่วคราว: ${createdTemp}`);
    } else {
      if (districtBasket.length < 1) {
        setError("ต้องมอบหมายอย่างน้อย 1 เขตการศึกษา");
        return;
      }
      const res = await adminUpsertAuditUserRpc(adminToken, {
        login_email: createForm.login_email,
        display_name: createForm.display_name,
        position: createForm.position,
        assigned_districts: districtBasket,
        temp_password: temp,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      createdTemp = res.temp_password || temp;
      setMessage(`สร้าง audit_user แล้ว — รหัสผ่านชั่วคราว: ${createdTemp}`);
    }
    setShowCreate(false);
    setCreateForm({ login_email: "", display_name: "", position: "" });
    setDistrictBasket([]);
    await search();
    // Restore success message after search (search clears errors only; keep temp visible)
    setMessage(
      `สร้างบัญชีแล้ว — รหัสผ่านชั่วคราว: ${createdTemp} (แสดงในแถวผู้ใช้จนกว่าจะตั้งรหัสผ่านใหม่)`
    );
  };

  const saveAuditDistricts = async (id: string) => {
    if (!adminToken) return;
    const res = await adminSetAuditDistrictsRpc(adminToken, id, auditBasket);
    if (!res.ok) {
      const hint = /admin_set_audit_districts|schema cache|function/i.test(res.error)
        ? " — รัน supabase/executive_dashboards_v1.sql"
        : "";
      setError(`${res.error}${hint}`);
      return;
    }
    const saved = res.assigned_districts;
    setMessage("อัปเดตเขตความรับผิดชอบแล้ว");
    setAuditEditId(null);
    await search();
    if (saved.length) {
      setExecutives((prev) => ({
        ...prev,
        audit: prev.audit.map((row) =>
          row.id === id && (row.assigned_districts ?? []).length === 0
            ? { ...row, assigned_districts: saved }
            : row
        ),
      }));
    }
  };

  const districtLabel = (id: string) => {
    const d = districtCatalog.find((x) => x.district_id === id);
    return d ? d.district_name : id;
  };

  const allExecutives = useMemo(
    () => [...executives.business, ...executives.audit],
    [executives.audit, executives.business]
  );
  const {
    filters: execFilters,
    setFilters: setExecFilters,
    filtered: filteredExecutives,
    reset: resetExecFilters,
  } = useExecutiveFilters(allExecutives);
  const {
    filters: candFilters,
    setFilters: setCandFilters,
    filtered: filteredUsers,
    schoolOptions,
    districtOptions,
    provinceOptions,
    reset: resetCandFilters,
  } = useCandidateFilters(users);
  const pagedUsers = paginateSlice(filteredUsers, userPage, PAGE_SIZE);
  const pagedExecutives = paginateSlice(filteredExecutives, execPage, PAGE_SIZE);

  const clearCandidateFilters = () => {
    resetCandFilters();
    setUserPage(1);
  };

  const clearExecutiveFilters = () => {
    resetExecFilters();
    setExecPage(1);
  };

  const switchTab = (tab: "candidates" | "executives") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    resetCandFilters();
    resetExecFilters();
    setUserPage(1);
    setExecPage(1);
  };

  const execSuspend = (ex: ExecutiveUserRow) =>
    withBusy(ex.id, async () => {
      if (!adminToken) return;
      const next = !(ex.is_active !== false);
      const res = await adminSetExecutiveActiveRpc(adminToken, ex.kind, ex.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(next ? "เปิดใช้งานบัญชีแล้ว" : "ระงับการใช้งานแล้ว");
    });

  const execSoftDelete = (ex: ExecutiveUserRow) =>
    withBusy(ex.id, async () => {
      if (!adminToken) return;
      if (!confirm(`ลบชั่วคราว ${ex.display_name}?`)) return;
      const res = await adminSoftDeleteExecutiveRpc(adminToken, ex.kind, ex.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("ลบบัญชีชั่วคราวแล้ว");
    });

  const execRestore = (ex: ExecutiveUserRow) =>
    withBusy(ex.id, async () => {
      if (!adminToken) return;
      const res = await adminRestoreExecutiveRpc(adminToken, ex.kind, ex.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("กู้คืนบัญชีแล้ว");
    });

  const execTempPassword = (ex: ExecutiveUserRow) =>
    withBusy(ex.id, async () => {
      if (!adminToken) return;
      const temp = generateTempPassword();
      const res = await adminResetExecutiveTempPasswordRpc(adminToken, ex.kind, ex.id, temp);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        `สร้างรหัสผ่านชั่วคราวแล้ว: ${res.temp_password} — ผู้ใช้ต้องตั้งรหัสผ่านใหม่เมื่อเข้าสู่ระบบครั้งถัดไป`
      );
    });

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up admin-surface">
      <AdminNav />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-2">
            จัดการ - ผู้ใช้งาน
          </h1>
          <p className="text-gray-500 dark:text-white/80 text-sm">
            ค้นหาผู้ใช้งานเพื่อจัดการบัญชี
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-xl bg-[var(--primary-blue)] text-white px-4 py-2.5 text-sm font-bold"
        >
          {showCreate ? "ปิดฟอร์ม" : "+ สร้าง User พิเศษ"}
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 space-y-3">
          <p className="text-sm font-semibold dark:text-white">
            สร้างผู้ใช้งานพิเศษ
          </p>
          <select
            className={inputClass}
            value={createKind}
            onChange={(e) => setCreateKind(e.target.value as "business" | "audit")}
          >
            <option value="business">business_user</option>
            <option value="audit">audit_user</option>
          </select>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className={inputClass}
              placeholder="ชื่อเข้าสู่ระบบ (a-z 0-9 . _ -) *"
              type="text"
              autoComplete="off"
              value={createForm.login_email}
              onChange={(e) =>
                setCreateForm((f) => ({
                  ...f,
                  login_email: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""),
                }))
              }
            />
            <input
              className={inputClass}
              placeholder="ชื่อแสดง *"
              value={createForm.display_name}
              onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))}
            />
            <input
              className={inputClass}
              placeholder="ตำแหน่ง"
              value={createForm.position}
              onChange={(e) => setCreateForm((f) => ({ ...f, position: e.target.value }))}
            />
          </div>
          {createKind === "audit" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold dark:text-white">เขตความรับผิดชอบ (หลายเขต)</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  className={inputClass}
                  value={districtPick}
                  onChange={(e) => setDistrictPick(e.target.value)}
                >
                  <option value="">เลือกเขต...</option>
                  {districtCatalog.map((d) => (
                    <option key={d.district_id} value={d.district_id}>
                      {d.district_name} ({d.district_id})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-[var(--primary-blue)]"
                  onClick={() => {
                    if (!districtPick) return;
                    setDistrictBasket((prev) =>
                      prev.includes(districtPick) ? prev : [...prev, districtPick]
                    );
                    setDistrictPick("");
                  }}
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {districtBasket.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs"
                    onClick={() => setDistrictBasket((prev) => prev.filter((x) => x !== id))}
                    title="คลิกเพื่อลบ"
                  >
                    {districtLabel(id)} ×
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void createSpecial()}
            className="rounded-xl bg-emerald-700 text-white px-4 py-2 text-sm font-bold"
          >
            สร้างบัญชี
          </button>
        </div>
      )}

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-3">{message}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => switchTab("candidates")}
          className={`rounded-full px-4 py-2 text-sm font-bold ${
            activeTab === "candidates"
              ? "bg-[var(--primary-blue)] text-white"
              : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-white"
          }`}
        >
          ผู้ใช้งานทั่วไป
        </button>
        <button
          type="button"
          onClick={() => switchTab("executives")}
          className={`rounded-full px-4 py-2 text-sm font-bold ${
            activeTab === "executives"
              ? "bg-[var(--primary-blue)] text-white"
              : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-white"
          }`}
        >
          ผู้ใช้งานพิเศษ
        </button>
      </div>

      {activeTab === "executives" && (
        <div className="mb-8">
          <h2 className="text-lg font-extrabold dark:text-white mb-3">ผู้ใช้งานพิเศษ</h2>
          <div className="mb-3 space-y-3 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-4">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                className={inputClass}
                placeholder="ค้นหา Login ID..."
                value={execFilters.loginId}
                onChange={(e) => {
                  setExecFilters((prev) => ({ ...prev, loginId: e.target.value }));
                  setExecPage(1);
                }}
              />
              <input
                className={inputClass}
                placeholder="ค้นหาชื่อแสดง..."
                value={execFilters.displayName}
                onChange={(e) => {
                  setExecFilters((prev) => ({ ...prev, displayName: e.target.value }));
                  setExecPage(1);
                }}
              />
              <select
                className={inputClass}
                value={execFilters.accountType}
                onChange={(e) => {
                  setExecFilters((prev) => ({
                    ...prev,
                    accountType: e.target.value as "all" | "business" | "audit",
                  }));
                  setExecPage(1);
                }}
              >
                <option value="all">ประเภทบัญชี: ทั้งหมด</option>
                <option value="business">Business User</option>
                <option value="audit">Audit User</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearExecutiveFilters}
                className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800"
              >
                ล้างตัวกรองทั้งหมด
              </button>
              <p className="self-center text-xs text-gray-500 dark:text-white/60">
                
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-black text-left dark:text-white">
                <tr>
                  <th className="px-3 py-3 font-semibold">ประเภท</th>
                  <th className="px-3 py-3 font-semibold">Login ID</th>
                  <th className="px-3 py-3 font-semibold">ชื่อแสดง</th>
                  <th className="px-3 py-3 font-semibold">ตำแหน่ง / เขต</th>
                  <th className="px-3 py-3 font-semibold">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pagedExecutives.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                      ยังไม่มีผู้ใช้งานพิเศษ
                    </td>
                  </tr>
                )}
                {pagedExecutives.map((ex) => {
                  const deleted = Boolean(ex.deleted_at);
                  const suspended = ex.is_active === false && !deleted;
                  return (
                    <tr
                      key={`${ex.kind}-${ex.id}`}
                      className="border-t border-gray-100 dark:border-slate-800 dark:text-white align-top"
                    >
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                          {ex.kind}
                        </span>
                        {ex.must_set_password && (
                          <div className="text-[10px] text-amber-600 mt-1">ต้องตั้งรหัสผ่านใหม่</div>
                        )}
                        {deleted && <div className="text-[10px] text-amber-600">ลบชั่วคราว</div>}
                        {suspended && <div className="text-[10px] text-red-500">ระงับ</div>}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        <div>{ex.login_email}</div>
                        {ex.must_set_password && ex.pending_temp_password ? (
                          <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-800 dark:bg-amber-950/40">
                            <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                              รหัสผ่านชั่วคราว
                            </div>
                            <div className="font-mono text-sm font-bold text-amber-950 dark:text-amber-100 select-all break-all">
                              {ex.pending_temp_password}
                            </div>
                          </div>
                        ) : ex.must_set_password ? (
                          <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                            ยังไม่ตั้งรหัสผ่าน — กด «สร้างรหัสผ่านชั่วคราว» เพื่อแสดงรหัส
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-semibold">{ex.display_name}</td>
                      <td className="px-3 py-3 text-xs">
                        {ex.position && <div>{ex.position}</div>}
                        {ex.kind === "audit" && (
                          <div className="text-gray-500 dark:text-white/70">
                            {(ex.assigned_districts ?? []).map(districtLabel).join(", ") || "—"}
                          </div>
                        )}
                        {ex.kind === "audit" && !deleted && (
                          <button
                            type="button"
                            className="mt-1 text-[11px] font-bold text-[var(--primary-blue)] underline"
                            onClick={() => {
                              setAuditEditId(ex.id);
                              setAuditBasket(ex.assigned_districts ?? []);
                            }}
                          >
                            จัดการเขต
                          </button>
                        )}
                        {auditEditId === ex.id && (
                          <div className="mt-2 space-y-2">
                            <div className="flex flex-col sm:flex-row gap-2">
                              <select
                                className={inputClass}
                                value={auditPick}
                                onChange={(e) => setAuditPick(e.target.value)}
                              >
                                <option value="">เลือกเขต...</option>
                                {districtCatalog.map((d) => (
                                  <option key={d.district_id} value={d.district_id}>
                                    {d.district_name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold"
                                onClick={() => {
                                  if (!auditPick) return;
                                  setAuditBasket((prev) =>
                                    prev.includes(auditPick) ? prev : [...prev, auditPick]
                                  );
                                  setAuditPick("");
                                }}
                              >
                                เพิ่ม
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"
                                onClick={() => void saveAuditDistricts(ex.id)}
                              >
                                บันทึก
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {auditBasket.map((id) => (
                                <button
                                  key={id}
                                  type="button"
                                  className="rounded-full border px-2 py-0.5 text-[10px]"
                                  onClick={() =>
                                    setAuditBasket((prev) => prev.filter((x) => x !== id))
                                  }
                                >
                                  {districtLabel(id)} ×
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex flex-row flex-wrap items-center gap-2">
                          {!deleted ? (
                            <>
                              <button
                                type="button"
                                disabled={busyId === ex.id}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 font-bold text-xs disabled:opacity-40"
                                onClick={() => void execSuspend(ex)}
                              >
                                {ex.is_active === false ? "เปิดใช้งาน" : "ระงับการใช้งาน"}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === ex.id}
                                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-indigo-900 font-bold text-xs disabled:opacity-40"
                                onClick={() => void execTempPassword(ex)}
                              >
                                สร้างรหัสผ่านชั่วคราว
                              </button>
                              <button
                                type="button"
                                disabled={busyId === ex.id}
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[var(--accent-red)] font-bold text-xs disabled:opacity-40"
                                onClick={() => void execSoftDelete(ex)}
                              >
                                ลบชั่วคราว
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === ex.id}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800 font-bold text-xs disabled:opacity-40"
                              onClick={() => void execRestore(ex)}
                            >
                              กู้คืน
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={execPage}
            pageSize={PAGE_SIZE}
            total={filteredExecutives.length}
            onPageChange={setExecPage}
          />
        </div>
      )}

      {activeTab === "candidates" && (
      <>
      <div className="bg-white dark:bg-slate-950 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 mb-4 space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <input
            className={inputClass}
            placeholder="ค้นหาอีเมลเข้าสู่ระบบ..."
            value={candFilters.loginEmail}
            onChange={(e) => {
              setCandFilters((prev) => ({ ...prev, loginEmail: e.target.value }));
              setUserPage(1);
            }}
          />
          <input
            className={inputClass}
            placeholder="ค้นหาชื่อผู้สมัคร..."
            value={candFilters.name}
            onChange={(e) => {
              setCandFilters((prev) => ({ ...prev, name: e.target.value }));
              setUserPage(1);
            }}
          />
          <input
            className={inputClass}
            placeholder="ค้นหารหัสโรงเรียน..."
            value={candFilters.schoolId}
            onChange={(e) => {
              setCandFilters((prev) => ({ ...prev, schoolId: e.target.value }));
              setUserPage(1);
            }}
          />
          <Combobox
            value={candFilters.schoolName}
            options={schoolOptions.map((school) => ({
              value: school.id,
              label: school.name,
            }))}
            placeholder="เลือกโรงเรียน"
            allLabel="โรงเรียนทั้งหมด"
            onChange={(value) => {
              setCandFilters((prev) => ({ ...prev, schoolName: value }));
              setUserPage(1);
            }}
          />
          <Combobox
            value={candFilters.districtId}
            options={districtOptions.map((district) => ({
              value: district.id,
              label: district.name,
            }))}
            placeholder="เลือกเขตพื้นที่การศึกษา"
            allLabel="เขตพื้นที่ทั้งหมด"
            onChange={(value) => {
              setCandFilters((prev) => ({ ...prev, districtId: value }));
              setUserPage(1);
            }}
          />
          <Combobox
            value={candFilters.province}
            options={provinceOptions}
            placeholder="เลือกจังหวัด"
            allLabel="จังหวัดทั้งหมด"
            onChange={(value) => {
              setCandFilters((prev) => ({ ...prev, province: value }));
              setUserPage(1);
            }}
          />
          <select
            className={inputClass}
            value={candFilters.portalRole}
            onChange={(e) => {
              setCandFilters((prev) => ({
                ...prev,
                portalRole: e.target.value as "all" | PortalRole,
              }));
              setUserPage(1);
            }}
          >
            <option value="all">เลือกบทบาท: ทั้งหมด</option>
            <option value="user">ผู้สมัคร</option>
            <option value="school_admin">ผู้ดูแลโรงเรียน</option>
          </select>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex items-center gap-2 text-sm whitespace-nowrap dark:text-white">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            รวมที่ถูกลบ (ยังสามารถกู้คืนได้)
          </label>
          <button
            type="button"
            onClick={() => void search()}
            disabled={loading}
            className="rounded-xl bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold disabled:opacity-40"
          >
            {loading ? "กำลังค้นหา..." : "ค้นหา"}
          </button>
          <button
            type="button"
            onClick={clearCandidateFilters}
            className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800"
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-white/60">          
        </p>
      </div>

      <h2 className="text-lg font-extrabold dark:text-white mb-3">ผู้ใช้งานทั่วไป</h2>
      <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-black text-left dark:text-white">
            <tr>
              <th className="px-3 py-3 font-semibold">หมายเลขสมาชิก</th>
              <th className="px-3 py-3 font-semibold">ชื่อ-นามสกุล</th>
              <th className="px-3 py-3 font-semibold">โทร</th>
              <th className="px-3 py-3 font-semibold">อีเมลเข้าสู่ระบบ</th>
              <th className="px-3 py-3 font-semibold">บทบาท</th>
              <th className="px-3 py-3 font-semibold">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pagedUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-400 dark:text-white/60">
                  {loading ? "กำลังโหลด..." : "ไม่พบผู้ใช้ — ลองพิมพ์คำค้นหา"}
                </td>
              </tr>
            )}
            {pagedUsers.map((u) => {
              const role = u.portal_role ?? "user";
              const deleted = Boolean(u.deleted_at);
              const suspended = u.is_active === false && !deleted;
              return (
                <tr
                  key={u.id}
                  className="border-t border-gray-100 dark:border-slate-800 dark:text-white align-top"
                >
                  <td className="px-3 py-3 font-mono text-xs">{u.id}</td>
                  <td className="px-3 py-3">
                    <div className="font-semibold">{u.full_name || "-"}</div>
                    <div className="text-xs text-gray-500 dark:text-white/60">
                      {u.school_id} {u.school_name ? `· ${u.school_name}` : ""}
                    </div>
                    {deleted && (
                      <span className="text-xs text-amber-600">ลบแล้ว (กู้คืนได้)</span>
                    )}
                    {suspended && <span className="text-xs text-red-500">ระงับ</span>}
                  </td>
                  <td className="px-3 py-3">{u.phone || "-"}</td>
                  <td className="px-3 py-3">
                    {emailEditId === u.id ? (
                      <div className="space-y-1 min-w-[180px]">
                        <input
                          className={inputClass}
                          type="email"
                          value={emailDraft}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          placeholder="อีเมลเข้าสู่ระบบ"
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            onClick={() => void saveEmail(u)}
                            className="text-xs font-bold text-emerald-700"
                          >
                            บันทึก
                          </button>
                          <button
                            type="button"
                            onClick={() => setEmailEditId(null)}
                            className="text-xs text-gray-500"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-mono text-xs">{u.login_email || u.email || "-"}</div>
                        {u.contact_email && u.contact_email !== u.login_email && (
                          <div className="text-[10px] text-gray-400">contact: {u.contact_email}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {roleEditId === u.id ? (
                      <div className="space-y-1 min-w-[160px]">
                        <select
                          className={inputClass}
                          value={roleDraft}
                          onChange={(e) => setRoleDraft(e.target.value as PortalRole)}
                        >
                          <option value="user">user</option>
                          <option value="school_admin">school_admin</option>
                        </select>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            onClick={() => void saveRole(u)}
                            className="text-xs font-bold text-emerald-700"
                          >
                            บันทึก
                          </button>
                          <button
                            type="button"
                            onClick={() => setRoleEditId(null)}
                            className="text-xs text-gray-500"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="font-mono text-xs">{ROLE_LABELS[role]}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex flex-row flex-wrap items-center gap-2">
                      {!deleted && (
                        <>
                          <button
                            type="button"
                            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[var(--primary-blue)] font-bold text-xs"
                            onClick={() => {
                              setRoleEditId(u.id);
                              setRoleDraft(role);
                              setEmailEditId(null);
                            }}
                          >
                            จัดการ Role
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-indigo-300 bg-indigo-100 px-3 py-1.5 text-indigo-900 font-bold text-xs shadow-sm"
                            onClick={() => {
                              setEmailEditId(u.id);
                              setEmailDraft(u.login_email || u.email || "");
                              setRoleEditId(null);
                            }}
                          >
                            แก้ไข Login ID
                          </button>
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 font-bold text-xs disabled:opacity-40"
                            onClick={() => void toggleActive(u)}
                          >
                            {u.is_active === false ? "เปิดใช้งาน" : "ระงับบัญชี"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[var(--accent-red)] font-bold text-xs disabled:opacity-40"
                            onClick={() => void softDelete(u)}
                          >
                            Soft Delete
                          </button>
                        </>
                      )}
                      {deleted && (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800 font-bold text-xs disabled:opacity-40"
                          onClick={() => void restore(u)}
                        >
                          กู้คืน
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={userPage}
        pageSize={PAGE_SIZE}
        total={filteredUsers.length}
        onPageChange={setUserPage}
      />
      </>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <AuthGuard requireAdmin>
      <UsersContent />
    </AuthGuard>
  );
}
