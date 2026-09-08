"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { useIctStore } from "@/contexts/IctStore";
import { STORAGE_KEYS } from "@/lib/storage";
import { getProjectRegistrationStatus, type PeriodStatus } from "@/lib/siteSettings";
import { disabledInputClass, inputClass } from "@/lib/styles";
import type { School, LearningProject } from "@/types/ict";

type PersonDraft = {
  key: string;
  profile_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  remark: string;
};

function emptyPerson(): PersonDraft {
  return {
    key: crypto.randomUUID(),
    profile_id: "",
    first_name: "",
    last_name: "",
    phone: "",
    remark: "",
  };
}

export default function RegisterFormPage() {
  const router = useRouter();
  const { lookupSchool, registerCandidate, projects, activeProjectId, setActiveProjectId } = useIctStore();
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [matched, setMatched] = useState<School | null>(null);
  const [codeError, setCodeError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [persons, setPersons] = useState<PersonDraft[]>([emptyPerson()]);
  const [periodLoading, setPeriodLoading] = useState(true);

  // Filter projects currently open for registration
  const activeProjects = projects.filter((p) => getProjectRegistrationStatus(p).open);
  const [selectedProjectId, setSelectedProjectId] = useState(
    activeProjectId && activeProjects.some((p) => p.id === activeProjectId)
      ? activeProjectId
      : activeProjects[0]?.id || ""
  );

  useEffect(() => {
    const ok = sessionStorage.getItem(STORAGE_KEYS.consent) === "accepted";
    if (!ok) {
      router.replace("/register/consent");
      setPeriodLoading(false);
      return;
    }
    setReady(true);
    setPeriodLoading(false);
  }, [router]);

  useEffect(() => {
    if (activeProjects.length > 0 && !activeProjects.some((p) => p.id === selectedProjectId)) {
      const firstId = activeProjects[0].id;
      setSelectedProjectId(firstId);
      setActiveProjectId(firstId);
    }
  }, [activeProjects, selectedProjectId, setActiveProjectId]);

  const resetSchoolVerification = () => {
    setMatched(null);
    setCodeError("");
    setFormError("");
    setPersons([emptyPerson()]);
  };

  const lookupSchoolHandler = async () => {
    const value = code.trim();
    if (!value) {
      setMatched(null);
      setCodeError("กรุณากรอกรหัสโรงเรียน");
      return;
    }
    setLookingUp(true);
    setCodeError("");
    setFormError("");
    try {
      const school = await lookupSchool(value);
      if (!school) {
        setMatched(null);
        setCodeError("ไม่พบรหัสโรงเรียนนี้ กรุณาตรวจสอบอีกครั้ง");
        return;
      }
      setMatched(school);
      setPersons([emptyPerson()]);
    } catch (err) {
      setMatched(null);
      setCodeError(err instanceof Error ? err.message : "ค้นหาโรงเรียนไม่สำเร็จ");
    } finally {
      setLookingUp(false);
    }
  };

  const updatePerson = (key: string, patch: Partial<PersonDraft>) => {
    setPersons((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const addPerson = () => {
    setPersons((prev) => [...prev, emptyPerson()]);
  };

  const removePerson = (key: string) => {
    setPersons((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.key !== key)));
  };

  const validatePersons = (): string | null => {
    const ids = new Set<string>();
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const label = `คนที่ ${i + 1}`;
      if (!/^\d{13}$/.test(p.profile_id.trim())) {
        return `${label}: เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก`;
      }
      if (!p.first_name.trim() || !p.last_name.trim()) {
        return `${label}: กรุณากรอกชื่อและนามสกุล`;
      }
      if (!p.phone.trim()) {
        return `${label}: กรุณากรอกเบอร์โทรศัพท์`;
      }
      const id = p.profile_id.trim();
      if (ids.has(id)) {
        return `เลขบัตรประชาชน ${id} ซ้ำในฟอร์ม`;
      }
      ids.add(id);
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const currentProject = projects.find((p) => p.id === selectedProjectId);
    if (!currentProject) {
      setFormError("กรุณาเลือกโครงการที่ต้องการสมัคร");
      return;
    }
    const status = getProjectRegistrationStatus(currentProject);
    if (!status.open) {
      setFormError(status.message);
      return;
    }

    if (!matched) {
      setFormError("กรุณาตรวจสอบรหัสโรงเรียนก่อนกรอกข้อมูลผู้สมัคร");
      return;
    }

    const validationError = validatePersons();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    const failures: string[] = [];
    let successCount = 0;

    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const result = await registerCandidate({
        profile_id: p.profile_id.trim(),
        school_id: matched.school_id,
        first_name: p.first_name,
        last_name: p.last_name,
        phone: p.phone,
        remark: p.remark,
      });
      if (!result.ok) {
        failures.push(`คนที่ ${i + 1} (${p.first_name} ${p.last_name}): ${result.error}`);
      } else {
        successCount += 1;
      }
    }

    setSubmitting(false);

    if (failures.length > 0) {
      setFormError(
        successCount > 0
          ? `บันทึกสำเร็จ ${successCount} คน แต่มีข้อผิดพลาด:\n${failures.join("\n")}`
          : failures.join("\n")
      );
      if (successCount === 0) return;
    }

    sessionStorage.removeItem(STORAGE_KEYS.consent);
    router.push("/register/success");
  };

  if (periodLoading || !ready) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--primary-blue)]" />
      </div>
    );
  }

  // If no active projects are open for registration
  if (activeProjects.length === 0) {
    return (
      <PeriodClosedNotice
        title="ขณะนี้ไม่มีโครงการ/วิชาที่เปิดรับลงทะเบียน"
        status={{
          open: false,
          reason: "disabled",
          start: null,
          end: null,
          message: "ขณะนี้ไม่มีโครงการ/วิชาที่เปิดรับลงทะเบียนในช่วงเวลานี้",
        }}
      />
    );
  }

  const isSingleProject = activeProjects.length === 1;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="bg-[var(--primary-blue)] px-8 py-6 text-white">
            <h1 className="text-2xl font-bold">แบบฟอร์มลงทะเบียน</h1>
            <p className="text-blue-100 mt-1">
              เลือกวิชา/โครงการ ตรวจสอบรหัสโรงเรียน จากนั้นกรอกข้อมูลผู้สมัคร (เพิ่มได้หลายคนต่อโรงเรียน)
            </p>
          </div>

          <div className="p-8 space-y-6">
            {/* Project Selection Dropdown */}
            <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-100">
              <label className="block text-sm font-bold text-[var(--primary-blue)] mb-2 flex items-center justify-between">
                <span>📚 เลือกวิชา / โครงการที่ต้องการสมัคร (Select Project):</span>
                {isSingleProject && (
                  <span className="text-[11px] font-semibold text-gray-500 bg-gray-200 px-2.5 py-0.5 rounded-full">
                    โครงการเดียวที่เปิดรับสมัคร
                  </span>
                )}
              </label>

              <select
                disabled={isSingleProject || submitting || lookingUp}
                value={selectedProjectId}
                onChange={(e) => {
                  const pId = e.target.value;
                  setSelectedProjectId(pId);
                  setActiveProjectId(pId);
                }}
                className={`w-full ${isSingleProject ? disabledInputClass : inputClass} font-semibold`}
              >
                {activeProjects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name} ({proj.id})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                {isSingleProject
                  ? "ระบบเปิดรับสมัครเฉพาะโครงการนี้ในช่วงเวลานี้"
                  : "สามารถเลือกโครงการที่ต้องการลงทะเบียนได้จากรายการข้างต้น"}
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary-blue)]">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--primary-blue)] text-white text-xs">
                1
              </span>
              ตรวจสอบรหัสโรงเรียน
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">รหัสโรงเรียน</label>
                <input
                  className={inputClass}
                  value={code}
                  placeholder="เช่น 1081010005"
                  disabled={lookingUp || submitting}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (matched) resetSchoolVerification();
                    else {
                      setCodeError("");
                      setMatched(null);
                    }
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => void lookupSchoolHandler()}
                disabled={lookingUp || submitting || !code.trim()}
                className="sm:self-end rounded-xl bg-[var(--primary-blue)] text-white px-6 py-3 font-bold hover:-translate-y-0.5 transition-all disabled:opacity-40"
              >
                {lookingUp ? "กำลังตรวจสอบ..." : "ตรวจสอบรหัส"}
              </button>
            </div>

            {codeError && <p className="text-sm text-[var(--accent-red)]">{codeError}</p>}

            {!matched && !codeError && (
              <p className="text-sm text-gray-500 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                กรุณากดปุ่ม “ตรวจสอบรหัส” เพื่อยืนยันรหัสโรงเรียนก่อนกรอกข้อมูลเพิ่มเติม
              </p>
            )}

            {matched && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-emerald-800">ข้อมูลโรงเรียน</p>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--primary-blue)] underline"
                    onClick={resetSchoolVerification}
                  >
                    เปลี่ยนรหัสโรงเรียน
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">รหัสโรงเรียน</label>
                    <input className={disabledInputClass} value={matched.school_id} disabled />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">ชื่อโรงเรียน</label>
                    <input className={disabledInputClass} value={matched.school_name} disabled />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">เขตพื้นที่</label>
                    <input className={disabledInputClass} value={matched.area_zone} disabled />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">จังหวัด</label>
                    <input className={disabledInputClass} value={matched.province} disabled />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {matched && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary-blue)] px-1">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--primary-blue)] text-white text-xs">
                2
              </span>
              ข้อมูลผู้สมัคร ({persons.length} คน)
            </div>

            {persons.map((person, index) => (
              <div
                key={person.key}
                className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
                  <h2 className="font-bold text-[var(--primary-blue)]">ผู้สมัครคนที่ {index + 1}</h2>
                  {persons.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePerson(person.key)}
                      disabled={submitting}
                      className="text-sm font-semibold text-[var(--accent-red)] hover:underline disabled:opacity-40"
                    >
                      ลบคนนี้
                    </button>
                  )}
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                      เลขบัตรประชาชน
                    </label>
                    <input
                      className={inputClass}
                      required
                      inputMode="numeric"
                      maxLength={13}
                      value={person.profile_id}
                      disabled={submitting}
                      onChange={(e) =>
                        updatePerson(person.key, {
                          profile_id: e.target.value.replace(/\D/g, "").slice(0, 13),
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ชื่อ</label>
                      <input
                        className={inputClass}
                        required
                        value={person.first_name}
                        disabled={submitting}
                        onChange={(e) => updatePerson(person.key, { first_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">นามสกุล</label>
                      <input
                        className={inputClass}
                        required
                        value={person.last_name}
                        disabled={submitting}
                        onChange={(e) => updatePerson(person.key, { last_name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                      เบอร์โทรศัพท์
                    </label>
                    <input
                      className={inputClass}
                      required
                      value={person.phone}
                      disabled={submitting}
                      onChange={(e) => updatePerson(person.key, { phone: e.target.value })}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      ใช้สำหรับติดต่อกลับ — วันเปิดเข้าสู่ระบบจะประกาศภายหลัง
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                      หมายเหตุ (ถ้ามี)
                    </label>
                    <input
                      className={inputClass}
                      value={person.remark}
                      disabled={submitting}
                      onChange={(e) => updatePerson(person.key, { remark: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addPerson}
              disabled={submitting}
              className="w-full rounded-2xl border-2 border-dashed border-[var(--primary-blue)]/40 text-[var(--primary-blue)] py-3 font-bold hover:bg-blue-50 transition-all disabled:opacity-40"
            >
              + เพิ่มผู้สมัครในโรงเรียนนี้
            </button>

            {formError && (
              <p className="text-sm text-[var(--accent-red)] whitespace-pre-line rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || lookingUp}
              className="w-full rounded-full bg-[var(--accent-red)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
            >
              {submitting
                ? `กำลังบันทึก ${persons.length} คน...`
                : `ยืนยันการลงทะเบียน (${persons.length} คน)`}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

