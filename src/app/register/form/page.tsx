"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { useIctStore } from "@/contexts/IctStore";
import { STORAGE_KEYS } from "@/lib/storage";
import { getProjectRegistrationStatus, getSiteProject } from "@/lib/siteSettings";
import { disabledInputClass, inputClass } from "@/lib/styles";
import {
  ENG_NAME_RE,
  THAI_NAME_RE,
  TITLE_OPTIONS,
  filterEnglishOnly,
  filterThaiOnly,
  getTitleByKey,
  type TitleKey,
} from "@/lib/titles";
import type { School } from "@/types/ict";

type PersonDraft = {
  key: string;
  profile_id: string;
  title_key: TitleKey | "";
  title_other_en: string;
  title_other_th: string;
  eng_first_name: string;
  eng_last_name: string;
  first_name: string;
  last_name: string;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  gender: "" | "male" | "female" | "other";
  position: string;
  duty: string;
  phone: string;
  line_id: string;
  email: string;
};

const MONTHS = [
  { value: "01", label: "ม.ค. (01)" },
  { value: "02", label: "ก.พ. (02)" },
  { value: "03", label: "มี.ค. (03)" },
  { value: "04", label: "เม.ย. (04)" },
  { value: "05", label: "พ.ค. (05)" },
  { value: "06", label: "มิ.ย. (06)" },
  { value: "07", label: "ก.ค. (07)" },
  { value: "08", label: "ส.ค. (08)" },
  { value: "09", label: "ก.ย. (09)" },
  { value: "10", label: "ต.ค. (10)" },
  { value: "11", label: "พ.ย. (11)" },
  { value: "12", label: "ธ.ค. (12)" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 80 }, (_, i) => String(currentYear - 15 - i));
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

function emptyPerson(): PersonDraft {
  return {
    key: crypto.randomUUID(),
    profile_id: "",
    title_key: "",
    title_other_en: "",
    title_other_th: "",
    eng_first_name: "",
    eng_last_name: "",
    first_name: "",
    last_name: "",
    birth_day: "",
    birth_month: "",
    birth_year: "",
    gender: "",
    position: "",
    duty: "",
    phone: "",
    line_id: "",
    email: "",
  };
}

function buildBirthDate(day: string, month: string, year: string): string | null {
  if (!day || !month || !year) return null;
  const iso = `${year}-${month}-${day}`;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() !== Number(year) || d.getMonth() + 1 !== Number(month) || d.getDate() !== Number(day)) {
    return null;
  }
  return iso;
}

export default function RegisterFormPage() {
  const router = useRouter();
  const { lookupSchool, registerCandidate, projects } = useIctStore();
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [matched, setMatched] = useState<School | null>(null);
  const [codeError, setCodeError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [persons, setPersons] = useState<PersonDraft[]>([emptyPerson()]);
  const [periodLoading, setPeriodLoading] = useState(true);

  const siteProject = getSiteProject(projects);
  const registrationOpen = siteProject ? getProjectRegistrationStatus(siteProject).open : false;

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

  const setLinkedTitle = (personKey: string, titleKey: TitleKey | "") => {
    updatePerson(personKey, {
      title_key: titleKey,
      ...(titleKey !== "other" ? { title_other_en: "", title_other_th: "" } : {}),
    });
  };

  const addPerson = () => {
    setPersons((prev) => [...prev, emptyPerson()]);
  };

  const removePerson = (key: string) => {
    setPersons((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.key !== key)));
  };

  const validatePersons = (): string | null => {
    const ids = new Set<string>();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const label = `คนที่ ${i + 1}`;

      if (!/^\d{13}$/.test(p.profile_id.trim())) {
        return `${label}: เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก`;
      }
      if (!p.title_key) {
        return `${label}: กรุณาเลือกคำนำหน้าชื่อ`;
      }
      const title = getTitleByKey(p.title_key);
      if (!title) return `${label}: คำนำหน้าชื่อไม่ถูกต้อง`;
      if (p.title_key === "other") {
        if (!p.title_other_en.trim() || !p.title_other_th.trim()) {
          return `${label}: กรุณากรอกคำนำหน้าชื่อ (Other / อื่นๆ) ทั้งภาษาอังกฤษและไทย`;
        }
      }
      if (!p.eng_first_name.trim() || !ENG_NAME_RE.test(p.eng_first_name.trim())) {
        return `${label}: Eng name ต้องเป็นตัวอักษรภาษาอังกฤษเท่านั้น`;
      }
      if (!p.eng_last_name.trim() || !ENG_NAME_RE.test(p.eng_last_name.trim())) {
        return `${label}: Eng surname ต้องเป็นตัวอักษรภาษาอังกฤษเท่านั้น`;
      }
      if (!p.first_name.trim() || !THAI_NAME_RE.test(p.first_name.trim())) {
        return `${label}: ชื่อไทยต้องเป็นตัวอักษรภาษาไทยเท่านั้น`;
      }
      if (!p.last_name.trim() || !THAI_NAME_RE.test(p.last_name.trim())) {
        return `${label}: นามสกุลไทยต้องเป็นตัวอักษรภาษาไทยเท่านั้น`;
      }
      const birth = buildBirthDate(p.birth_day, p.birth_month, p.birth_year);
      if (!birth) {
        return `${label}: กรุณาเลือกวัน เดือน ปีเกิดให้ถูกต้อง`;
      }
      if (!p.gender) {
        return `${label}: กรุณาเลือกเพศ`;
      }
      if (!p.position.trim()) {
        return `${label}: กรุณากรอกตำแหน่ง`;
      }
      if (!p.duty.trim()) {
        return `${label}: กรุณากรอกหน้าที่`;
      }
      if (!p.phone.trim()) {
        return `${label}: กรุณากรอกเบอร์โทรศัพท์`;
      }
      if (!p.line_id.trim()) {
        return `${label}: กรุณากรอก Line ID`;
      }
      if (!p.email.trim() || !emailRe.test(p.email.trim())) {
        return `${label}: กรุณากรอกอีเมลให้ถูกต้อง`;
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

    if (!siteProject) {
      setFormError("ไม่พบโครงการที่เปิดรับสมัคร");
      return;
    }
    const status = getProjectRegistrationStatus(siteProject);
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
      const title = getTitleByKey(p.title_key as TitleKey)!;
      const birth_date = buildBirthDate(p.birth_day, p.birth_month, p.birth_year)!;
      const title_en = p.title_key === "other" ? p.title_other_en.trim() : title.en;
      const title_th = p.title_key === "other" ? p.title_other_th.trim() : title.th;
      const displayLabel =
        p.title_key === "other"
          ? `${p.title_other_th.trim()} ${p.first_name} ${p.last_name}`
          : `${title.th} ${p.first_name} ${p.last_name}`;

      const result = await registerCandidate({
        profile_id: p.profile_id.trim(),
        school_id: matched.school_id,
        first_name: p.first_name.trim(),
        last_name: p.last_name.trim(),
        phone: p.phone.trim(),
        title_key: p.title_key,
        title_en,
        title_th,
        title_other_en: p.title_key === "other" ? p.title_other_en.trim() : undefined,
        title_other_th: p.title_key === "other" ? p.title_other_th.trim() : undefined,
        eng_first_name: p.eng_first_name.trim(),
        eng_last_name: p.eng_last_name.trim(),
        birth_date,
        gender: p.gender,
        position: p.position.trim(),
        duty: p.duty.trim(),
        line_id: p.line_id.trim(),
        email: p.email.trim(),
        project_id: siteProject.id,
      });
      if (!result.ok) {
        failures.push(`คนที่ ${i + 1} (${displayLabel}): ${result.error}`);
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

  if (!siteProject || !registrationOpen) {
    return (
      <PeriodClosedNotice
        title="ขณะนี้ปิดรับลงทะเบียน"
        status={
          siteProject
            ? getProjectRegistrationStatus(siteProject)
            : {
                open: false,
                reason: "disabled",
                start: null,
                end: null,
                message: "ขณะนี้ไม่มีโครงการที่เปิดรับลงทะเบียนในช่วงเวลานี้",
              }
        }
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="bg-[var(--primary-blue)] px-8 py-6 text-white">
            <h1 className="text-2xl font-bold">แบบฟอร์มลงทะเบียน</h1>
            <p className="text-blue-100 mt-1">
              ตรวจสอบรหัสโรงเรียนก่อนเริ่มกรอกข้อมูลผู้สมัคร
            </p>
          </div>

          <div className="p-8 space-y-6">
            <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-100">
              <p className="text-sm font-bold text-[var(--primary-blue)] mb-1">📚 โครงการที่เปิดรับสมัคร</p>
              <p className="text-base font-extrabold text-gray-800">{siteProject.name}</p>
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
              ข้อมูลผู้สมัคร (ทั้งหมด {persons.length} คน)
            </div>

            {persons.map((person, index) => {
              const isOther = person.title_key === "other";
              return (
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
                        Personal ID / เลขบัตรประชาชน
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
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          Eng Title
                        </label>
                        <select
                          className={inputClass}
                          required
                          value={person.title_key}
                          disabled={submitting}
                          onChange={(e) => setLinkedTitle(person.key, e.target.value as TitleKey | "")}
                        >
                          <option value="">-- Select --</option>
                          {TITLE_OPTIONS.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.en}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          Thai Title / คำนำหน้า
                        </label>
                        <select
                          className={inputClass}
                          required
                          value={person.title_key}
                          disabled={submitting}
                          onChange={(e) => setLinkedTitle(person.key, e.target.value as TitleKey | "")}
                        >
                          <option value="">-- เลือก --</option>
                          {TITLE_OPTIONS.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.th}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 -mt-2">
                      คำนำหน้า EN และ TH เชื่อมกัน — เปลี่ยนฝั่งใดฝั่งหนึ่ง อีกฝั่งจะเปลี่ยนตาม
                    </p>

                    {isOther && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                            Other title (EN)
                          </label>
                          <input
                            className={inputClass}
                            required
                            value={person.title_other_en}
                            disabled={submitting}
                            placeholder="Please specify"
                            onChange={(e) => updatePerson(person.key, { title_other_en: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                            คำนำหน้าอื่นๆ (TH)
                          </label>
                          <input
                            className={inputClass}
                            required
                            value={person.title_other_th}
                            disabled={submitting}
                            placeholder="กรุณาระบุ"
                            onChange={(e) => updatePerson(person.key, { title_other_th: e.target.value })}
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          Eng name
                        </label>
                        <input
                          className={inputClass}
                          required
                          lang="en"
                          autoCapitalize="words"
                          value={person.eng_first_name}
                          disabled={submitting}
                          placeholder="English only"
                          onChange={(e) =>
                            updatePerson(person.key, { eng_first_name: filterEnglishOnly(e.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          Eng surname
                        </label>
                        <input
                          className={inputClass}
                          required
                          lang="en"
                          autoCapitalize="words"
                          value={person.eng_last_name}
                          disabled={submitting}
                          placeholder="English only"
                          onChange={(e) =>
                            updatePerson(person.key, { eng_last_name: filterEnglishOnly(e.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          ชื่อ (ไทย)
                        </label>
                        <input
                          className={inputClass}
                          required
                          lang="th"
                          value={person.first_name}
                          disabled={submitting}
                          placeholder="ภาษาไทยเท่านั้น"
                          onChange={(e) =>
                            updatePerson(person.key, { first_name: filterThaiOnly(e.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          นามสกุล (ไทย)
                        </label>
                        <input
                          className={inputClass}
                          required
                          lang="th"
                          value={person.last_name}
                          disabled={submitting}
                          placeholder="ภาษาไทยเท่านั้น"
                          onChange={(e) =>
                            updatePerson(person.key, { last_name: filterThaiOnly(e.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                        วัน / เดือน / ปีเกิด (ค.ศ.)
                      </label>
                      <div className="grid grid-cols-3 gap-3">
                        <select
                          className={inputClass}
                          required
                          value={person.birth_day}
                          disabled={submitting}
                          onChange={(e) => updatePerson(person.key, { birth_day: e.target.value })}
                        >
                          <option value="">วัน</option>
                          {DAYS.map((d) => (
                            <option key={d} value={d}>
                              {Number(d)}
                            </option>
                          ))}
                        </select>
                        <select
                          className={inputClass}
                          required
                          value={person.birth_month}
                          disabled={submitting}
                          onChange={(e) => updatePerson(person.key, { birth_month: e.target.value })}
                        >
                          <option value="">เดือน</option>
                          {MONTHS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className={inputClass}
                          required
                          value={person.birth_year}
                          disabled={submitting}
                          onChange={(e) => updatePerson(person.key, { birth_year: e.target.value })}
                        >
                          <option value="">ปี</option>
                          {YEARS.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">เพศ / Gender</label>
                      <select
                        className={inputClass}
                        required
                        value={person.gender}
                        disabled={submitting}
                        onChange={(e) =>
                          updatePerson(person.key, {
                            gender: e.target.value as PersonDraft["gender"],
                          })
                        }
                      >
                        <option value="">-- เลือก --</option>
                        <option value="male">ชาย / Male</option>
                        <option value="female">หญิง / Female</option>
                        <option value="other">อื่นๆ / Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                        ตำแหน่ง / Position
                      </label>
                      <input
                        className={inputClass}
                        required
                        value={person.position}
                        disabled={submitting}
                        placeholder="ครูชำนาญการ"
                        onChange={(e) => updatePerson(person.key, { position: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                        หน้าที่ / Duty
                      </label>
                      <input
                        className={inputClass}
                        required
                        value={person.duty}
                        disabled={submitting}
                        placeholder="สอนวิชา ... ระดับชั้น ..."
                        onChange={(e) => updatePerson(person.key, { duty: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          เบอร์โทรศัพท์ / Phone
                        </label>
                        <input
                          className={inputClass}
                          required
                          inputMode="tel"
                          value={person.phone}
                          disabled={submitting}
                          onChange={(e) => updatePerson(person.key, { phone: e.target.value })}
                        />
                        <p className="text-xs text-gray-500 mt-1">ใช้สำหรับเข้าสู่ระบบ</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                          Line ID
                        </label>
                        <input
                          className={inputClass}
                          required
                          value={person.line_id}
                          disabled={submitting}
                          onChange={(e) => updatePerson(person.key, { line_id: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                        E-mail
                      </label>
                      <input
                        className={inputClass}
                        required
                        type="email"
                        inputMode="email"
                        value={person.email}
                        disabled={submitting}
                        onChange={(e) => updatePerson(person.key, { email: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

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
