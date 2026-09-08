"use client";

import { useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import { inputClass } from "@/lib/styles";
import { extractYouTubeId, parseAnswerKeysCsv } from "@/lib/supabase/projects";
import type { Candidate, ExamProgress, LearningProject, ProjectQuestion, ProjectVideo, QuestionType } from "@/types/ict";

function ProjectsManagementContent() {
  const {
    projects,
    videos,
    questions,
    candidates,
    examProgress,
    saveProject,
    deleteProject,
    saveProjectVideo,
    deleteProjectVideo,
    saveProjectQuestion,
    deleteProjectQuestion,
    bulkSaveAnswerKeys,
    gradeProjectExams,
  } = useIctStore();

  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || "ict-talent-2026");
  const [activeTab, setActiveTab] = useState<"details" | "videos" | "exam" | "keys">("details");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Modal / Form states for Projects
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projForm, setProjForm] = useState<LearningProject>({
    id: "",
    name: "",
    description: "",
    reg_enabled: true,
    exam_enabled: true,
    pass_threshold: 3,
    max_score: 5,
  });
  const [isEditingProj, setIsEditingProj] = useState(false);

  // Modal / Form states for Videos
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoForm, setVideoForm] = useState<ProjectVideo>({
    id: "",
    project_id: selectedProjectId,
    title: "",
    video_url: "",
    video_id: "",
    is_mandatory: false,
    order_index: 0,
  });

  // Modal / Form states for Questions (Exam Builder)
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [qForm, setQForm] = useState<{
    id: string;
    project_id: string;
    prompt: string;
    type: QuestionType;
    options: string[];
    correct_answer: string;
    model_answer: string;
    points: number;
  }>({
    id: "",
    project_id: selectedProjectId,
    prompt: "",
    type: "mcq",
    options: ["ตัวเลือก 1", "ตัวเลือก 2", "ตัวเลือก 3", "ตัวเลือก 4"],
    correct_answer: "ตัวเลือก 1",
    model_answer: "",
    points: 1,
  });
  const [isEditingQ, setIsEditingQ] = useState(false);

  // CSV Answer Keys Upload State
  const [csvContent, setCsvContent] = useState("");
  const [csvParsed, setCsvParsed] = useState<{ questionIdOrOrder: string; correctAnswer: string }[]>([]);

  // Grading Result Modal State
  const [gradingResult, setGradingResult] = useState<{ gradedCount: number; passedCount: number } | null>(null);
  const [isGrading, setIsGrading] = useState(false);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0];
  const projectVideos = videos.filter((v) => v.project_id === selectedProjectId);
  const projectQuestions = questions.filter((q) => q.project_id === selectedProjectId);
  const calculatedMaxScore = projectQuestions.reduce((acc, q) => acc + (q.points || 1), 0);

  const projectExams = examProgress.filter(
    (e) => e.project_id === selectedProjectId || (!e.project_id && selectedProjectId === projects[0]?.id)
  );

  const showStatus = (msg: string, isErr = false) => {
    if (isErr) {
      setErrorMsg(msg);
      setStatusMsg("");
    } else {
      setStatusMsg(msg);
      setErrorMsg("");
    }
    setTimeout(() => {
      setStatusMsg("");
      setErrorMsg("");
    }, 4000);
  };

  // Export candidate exam data handlers
  const handleExportCsv = () => {
    if (projectExams.length === 0) {
      showStatus("ไม่พบข้อมูลการทำข้อสอบสำหรับส่งออก", true);
      return;
    }
    const headers = [
      "Candidate ID",
      "Full Name",
      "School ID",
      "School Name",
      "Phone",
      "Exam Status",
      "Score",
      "Passed",
      "Graded At",
      "Updated At",
      ...projectQuestions.map((q, idx) => `Q${idx + 1} (${q.id})`),
    ];

    const rows = projectExams.map((e) => {
      const cand = candidates.find((c) => c.id === e.candidate_id);
      const candidateName = cand ? `${cand.first_name} ${cand.last_name}` : "N/A";
      const schoolId = cand?.school_id || "N/A";
      const schoolName = cand?.school_name || "N/A";
      const phone = cand?.phone || "N/A";

      const answers = e.answers || {};
      const questionAnswers = projectQuestions.map((q) => {
        const ans = answers[q.id] || "";
        return `"${ans.replace(/"/g, '""')}"`;
      });

      return [
        `"${e.candidate_id}"`,
        `"${candidateName}"`,
        `"${schoolId}"`,
        `"${schoolName}"`,
        `"${phone}"`,
        `"${e.status}"`,
        e.score ?? "-",
        e.passed === undefined ? "-" : e.passed ? "PASSED" : "FAILED",
        `"${e.graded_at || "-"}"`,
        `"${e.updated_at || "-"}"`,
        ...questionAnswers,
      ].join(",");
    });

    const csvContentData = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContentData], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `exam_responses_${selectedProjectId}_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus(`ส่งออกข้อมูลข้อสอบ (${projectExams.length} รายการ) เป็น CSV สำเร็จ`);
  };

  const handleExportJson = () => {
    if (projectExams.length === 0) {
      showStatus("ไม่พบข้อมูลการทำข้อสอบสำหรับส่งออก", true);
      return;
    }
    const exportPayload = projectExams.map((e) => {
      const cand = candidates.find((c) => c.id === e.candidate_id);
      return {
        candidate_id: e.candidate_id,
        candidate_name: cand ? `${cand.first_name} ${cand.last_name}` : null,
        school_id: cand?.school_id || null,
        school_name: cand?.school_name || null,
        phone: cand?.phone || null,
        project_id: selectedProjectId,
        exam_status: e.status,
        score: e.score ?? null,
        passed: e.passed ?? null,
        graded_at: e.graded_at || null,
        updated_at: e.updated_at,
        answers: e.answers,
      };
    });

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `exam_responses_${selectedProjectId}_${timestamp}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus(`ส่งออกข้อมูลข้อสอบ (${projectExams.length} รายการ) เป็น JSON สำเร็จ`);
  };

  // Handle Project Save
  const handleSaveProject = async () => {
    if (!projForm.id.trim() || !projForm.name.trim()) {
      showStatus("กรุณากรอกรหัสโครงการและชื่อโครงการ", true);
      return;
    }
    // Max score is dynamically calculated from question points
    const payload = {
      ...projForm,
      max_score: calculatedMaxScore > 0 ? calculatedMaxScore : projForm.max_score || 5,
    };
    const res = await saveProject(payload);
    if (res.ok) {
      showStatus("บันทึกโครงการและกำหนดการเรียบร้อยแล้ว");
      setSelectedProjectId(projForm.id);
      setShowProjectModal(false);
    } else {
      showStatus(res.error, true);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (projects.length <= 1) {
      showStatus("ต้องมีอย่างน้อย 1 โครงการในระบบ", true);
      return;
    }
    if (confirm("คุณแน่ใจหรือไม่ที่จะลบโครงการนี้พร้อมวิดีโอและข้อสอบทั้งหมด?")) {
      const res = await deleteProject(id);
      if (res.ok) {
        showStatus("ลบโครงการเรียบร้อยแล้ว");
        const remaining = projects.filter((p) => p.id !== id);
        if (remaining.length > 0) setSelectedProjectId(remaining[0].id);
      } else {
        showStatus(res.error, true);
      }
    }
  };

  // Handle Video Save
  const handleSaveVideo = async () => {
    if (!videoForm.title.trim() || !videoForm.video_url.trim()) {
      showStatus("กรุณากรอกชื่อวิดีโอและลิงก์วิดีโอ (YouTube URL)", true);
      return;
    }
    const extractedId = extractYouTubeId(videoForm.video_url);
    const payload: ProjectVideo = {
      ...videoForm,
      id: videoForm.id || crypto.randomUUID(),
      project_id: selectedProjectId,
      video_id: extractedId,
    };
    const res = await saveProjectVideo(payload);
    if (res.ok) {
      showStatus("บันทึกวิดีโอเรียบร้อยแล้ว");
      setShowVideoModal(false);
    } else {
      showStatus(res.error, true);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    if (confirm("ลบวิดีโอนี้?")) {
      const res = await deleteProjectVideo(id);
      if (res.ok) showStatus("ลบวิดีโอเรียบร้อยแล้ว");
      else showStatus(res.error, true);
    }
  };

  const handleToggleVideoMandatory = async (video: ProjectVideo) => {
    const updated = { ...video, is_mandatory: !video.is_mandatory };
    const res = await saveProjectVideo(updated);
    if (res.ok) showStatus(`อัปเดตการบังคับสำหรับข้อสอบเป็น ${updated.is_mandatory ? "บังคับ" : "ไม่บังคับ"}`);
    else showStatus(res.error, true);
  };

  // Handle Question Save
  const handleSaveQuestion = async () => {
    if (!qForm.prompt.trim()) {
      showStatus("กรุณากรอกโจทย์/คำถาม", true);
      return;
    }
    const payload: ProjectQuestion = {
      id: qForm.id || crypto.randomUUID(),
      project_id: selectedProjectId,
      prompt: qForm.prompt.trim(),
      type: qForm.type,
      options: qForm.type === "mcq" ? qForm.options.filter((o) => o.trim() !== "") : undefined,
      correct_answer: qForm.type === "mcq" ? qForm.correct_answer : undefined,
      model_answer: qForm.type === "open_ended" ? qForm.model_answer.trim() : undefined,
      points: Number(qForm.points) || 1,
      order_index: projectQuestions.length + 1,
    };

    const res = await saveProjectQuestion(payload);
    if (res.ok) {
      showStatus("บันทึกคำถามเรียบร้อยแล้ว");
      setShowQuestionModal(false);
    } else {
      showStatus(res.error, true);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (confirm("ลบข้อสอบข้อนี้?")) {
      const res = await deleteProjectQuestion(id);
      if (res.ok) showStatus("ลบข้อสอบเรียบร้อยแล้ว");
      else showStatus(res.error, true);
    }
  };

  // CSV Answer Keys Upload Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text);
      const parsed = parseAnswerKeysCsv(text);
      setCsvParsed(parsed);
    };
    reader.readAsText(file);
  };

  const handleApplyCsvAnswerKeys = async () => {
    if (csvParsed.length === 0) {
      showStatus("ไม่พบข้อมูลเฉลยคำตอบในไฟล์ CSV", true);
      return;
    }
    const res = await bulkSaveAnswerKeys(selectedProjectId, csvParsed);
    if (res.ok) {
      showStatus(`อัปเดตเฉลยคำตอบจาก CSV สำเร็จ ${res.updatedCount} ข้อ`);
      setCsvContent("");
      setCsvParsed([]);
    } else {
      showStatus(res.error, true);
    }
  };

  // Manual Grading Trigger Action
  const handleTriggerGrading = async () => {
    if (confirm(`ยืนยันการเริ่มระบบ "ตรวจคำตอบ (Grade Exams)" สำหรับโครงการ ${currentProject.name}?`)) {
      setIsGrading(true);
      const res = await gradeProjectExams(selectedProjectId);
      setIsGrading(false);
      if (res.ok) {
        setGradingResult({ gradedCount: res.gradedCount, passedCount: res.passedCount });
        showStatus("ประมวลผลการตรวจคำตอบเรียบร้อยแล้ว");
      } else {
        showStatus(res.error, true);
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)]">จัดการวิชา & ระบบตรวจข้อสอบ (Anti-Cheating)</h1>
          <p className="text-gray-500 text-sm mt-1">
            บริหารจัดการ Project ID, กำหนดการ, คลิปวิดีโอ, Exam Builder, แยกคลังเฉลยคำตอบ (Answer Keys) และระบบตรวจข้อสอบ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-full bg-blue-600 text-white px-4 py-2.5 font-bold text-xs hover:bg-blue-700 shadow transition-all flex items-center gap-1.5"
          >
            <span>📥 Export Answers (CSV)</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="rounded-full bg-indigo-600 text-white px-4 py-2.5 font-bold text-xs hover:bg-indigo-700 shadow transition-all flex items-center gap-1.5"
          >
            <span>📥 Export Answers (JSON)</span>
          </button>
          <button
            type="button"
            disabled={isGrading}
            onClick={() => void handleTriggerGrading()}
            className="rounded-full bg-emerald-600 text-white px-5 py-2.5 font-bold text-xs hover:bg-emerald-700 shadow transition-all flex items-center gap-1.5 disabled:opacity-40"
          >
            <span>{isGrading ? "กำลังประมวลผล..." : "⚡ ตรวจคำตอบ (Grade Exams)"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setProjForm({
                id: `proj-${Date.now().toString().slice(-4)}`,
                name: "",
                description: "",
                reg_enabled: true,
                exam_enabled: true,
                pass_threshold: 3,
                max_score: calculatedMaxScore || 5,
              });
              setIsEditingProj(false);
              setShowProjectModal(true);
            }}
            className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold text-xs hover:bg-blue-900 shadow transition-all"
          >
            <span>+ เพิ่มโครงการ/วิชาใหม่</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold animate-fade-in">
          ✓ {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm font-semibold animate-fade-in">
          ✕ {errorMsg}
        </div>
      )}

      {/* Project Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {projects.map((proj) => {
          const isSelected = proj.id === selectedProjectId;
          const projVids = videos.filter((v) => v.project_id === proj.id);
          const projQs = questions.filter((q) => q.project_id === proj.id);
          const projMaxScore = projQs.reduce((acc, q) => acc + (q.points || 1), 0);

          return (
            <div
              key={proj.id}
              onClick={() => setSelectedProjectId(proj.id)}
              className={`cursor-pointer rounded-2xl p-5 border-2 transition-all shadow-sm relative overflow-hidden ${
                isSelected
                  ? "border-[var(--primary-blue)] bg-blue-50/60 shadow-md"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              {isSelected && (
                <div className="absolute top-0 right-0 bg-[var(--primary-blue)] text-white text-[10px] font-extrabold px-3 py-1 rounded-bl-xl">
                  เลือกอยู่
                </div>
              )}
              <div className="text-xs font-mono font-bold text-gray-400 mb-1">Project ID: {proj.id}</div>
              <h3 className="font-extrabold text-gray-800 text-lg mb-1 line-clamp-1">{proj.name}</h3>
              <p className="text-xs text-gray-500 mb-4 line-clamp-2">{proj.description || "ไม่มีคำอธิบาย"}</p>
              <div className="flex items-center justify-between text-xs font-bold text-gray-600 border-t border-gray-100 pt-3">
                <span className="bg-blue-100/70 text-blue-800 px-2 py-0.5 rounded">📹 {projVids.length} วิดีโอ</span>
                <span className="bg-purple-100/70 text-purple-800 px-2 py-0.5 rounded">📝 {projQs.length} ข้อสอบ</span>
                <span className="bg-emerald-100/70 text-emerald-800 px-2 py-0.5 rounded">
                  เกณฑ์ผ่าน {proj.pass_threshold ?? 3}/{projMaxScore > 0 ? projMaxScore : proj.max_score ?? 5}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Dashboard Section */}
      {currentProject && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Sub Navigation Tabs */}
          <div className="flex flex-wrap border-b border-gray-100 bg-gray-50/70 px-6 pt-4 gap-2 md:gap-4">
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`pb-4 px-4 font-bold text-sm border-b-2 transition-all ${
                activeTab === "details"
                  ? "border-[var(--primary-blue)] text-[var(--primary-blue)]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              ⚙️ ข้อมูล & กำหนดการ ({currentProject.id})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("videos")}
              className={`pb-4 px-4 font-bold text-sm border-b-2 transition-all ${
                activeTab === "videos"
                  ? "border-[var(--primary-blue)] text-[var(--primary-blue)]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              🎬 วิดีโอบทเรียน ({projectVideos.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("exam")}
              className={`pb-4 px-4 font-bold text-sm border-b-2 transition-all ${
                activeTab === "exam"
                  ? "border-[var(--primary-blue)] text-[var(--primary-blue)]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              ✍️ Exam Builder (สร้างโจทย์) ({projectQuestions.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("keys")}
              className={`pb-4 px-4 font-bold text-sm border-b-2 transition-all ${
                activeTab === "keys"
                  ? "border-emerald-600 text-emerald-800 bg-emerald-50/50 rounded-t-xl"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              🔑 Answer Keys (เฉลย & ตรวจคำตอบ)
            </button>
          </div>

          <div className="p-8">
            {/* TAB 1: Project Details & Schedules */}
            {activeTab === "details" && (
              <div>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-1">{currentProject.name}</h2>
                    <p className="text-gray-500 text-sm">รหัสวิชา/โครงการ: {currentProject.id}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setProjForm({
                          ...currentProject,
                          max_score: calculatedMaxScore > 0 ? calculatedMaxScore : currentProject.max_score || 5,
                        });
                        setIsEditingProj(true);
                        setShowProjectModal(true);
                      }}
                      className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm"
                    >
                      ✏️ แก้ไขข้อมูล & กำหนดการ
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteProject(currentProject.id)}
                      className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm"
                    >
                      🗑️ ลบโครงการ
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">รายละเอียดวิชา:</h4>
                    <p className="text-gray-700 leading-relaxed text-sm">{currentProject.description || "ยังไม่มีรายละเอียด"}</p>
                  </div>

                  <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 space-y-3">
                    <h4 className="text-xs font-bold text-[var(--primary-blue)] uppercase tracking-wider">
                      เกณฑ์การให้คะแนนและการผ่าน:
                    </h4>
                    <div className="flex justify-between items-center text-sm border-b border-blue-100 pb-2">
                      <span className="text-gray-600">เกณฑ์คะแนนผ่าน (Pass Threshold):</span>
                      <span className="font-extrabold text-[var(--primary-blue)]">{currentProject.pass_threshold ?? 3} คะแนน</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">คะแนนเต็มวิชานี้ (Max Score):</span>
                      <span className="font-bold text-gray-800">
                        {calculatedMaxScore > 0 ? calculatedMaxScore : currentProject.max_score ?? 5} คะแนน
                      </span>
                    </div>
                  </div>
                </div>

                {/* Schedule Status Box */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-amber-50/60 p-6 rounded-2xl border border-amber-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-amber-900 text-sm">🗓️ ช่วงเปิดรับลงทะเบียนประจำวิชา</h4>
                      <span
                        className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                          currentProject.reg_enabled ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                        }`}
                      >
                        {currentProject.reg_enabled ? "เปิดรับสมัคร" : "ปิดรับสมัคร"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">
                      เริ่ม: {currentProject.reg_start ? new Date(currentProject.reg_start).toLocaleString("th-TH") : "ไม่กำหนด"}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      สิ้นสุด: {currentProject.reg_end ? new Date(currentProject.reg_end).toLocaleString("th-TH") : "ไม่กำหนด"}
                    </p>
                  </div>

                  <div className="bg-purple-50/60 p-6 rounded-2xl border border-purple-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-purple-900 text-sm">✍️ ช่วงเปิดเข้าสอบประจำวิชา</h4>
                      <span
                        className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                          currentProject.exam_enabled ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                        }`}
                      >
                        {currentProject.exam_enabled ? "เปิดให้สอบ" : "ปิดระบบสอบ"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">
                      เริ่ม: {currentProject.exam_start ? new Date(currentProject.exam_start).toLocaleString("th-TH") : "ไม่กำหนด"}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      สิ้นสุด: {currentProject.exam_end ? new Date(currentProject.exam_end).toLocaleString("th-TH") : "ไม่กำหนด"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Videos Management */}
            {activeTab === "videos" && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">วิดีโอบทเรียน ({projectVideos.length})</h2>
                    <p className="text-xs text-gray-500">จัดการลิงก์วิดีโอ YouTube พร้อมสวิตช์เปิด/ปิด flag “Mandatory for Exam”</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoForm({
                        id: crypto.randomUUID(),
                        project_id: selectedProjectId,
                        title: "",
                        video_url: "",
                        video_id: "",
                        is_mandatory: false,
                        order_index: projectVideos.length + 1,
                      });
                      setShowVideoModal(true);
                    }}
                    className="px-5 py-2.5 rounded-full bg-[var(--primary-blue)] text-white text-sm font-bold shadow hover:bg-blue-900"
                  >
                    + เพิ่มวิดีโอในโครงการนี้
                  </button>
                </div>

                {projectVideos.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 bg-gray-50 rounded-2xl border border-dashed">
                    ยังไม่มีวิดีโอในโครงการนี้ กด “+ เพิ่มวิดีโอ” ด้านบนเพื่อเริ่มต้น
                  </div>
                ) : (
                  <div className="space-y-4">
                    {projectVideos.map((vid, idx) => (
                      <div
                        key={vid.id}
                        className="p-5 rounded-2xl border border-gray-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-blue-50 text-[var(--primary-blue)] font-extrabold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-gray-800 text-base">{vid.title}</h3>
                              {vid.is_mandatory && (
                                <span className="text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-0.5 rounded-full">
                                  ★ Mandatory for Exam
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-mono text-gray-500 mt-1">URL: {vid.video_url}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleVideoMandatory(vid)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                              vid.is_mandatory
                                ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                                : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
                            }`}
                          >
                            {vid.is_mandatory ? "✓ Mandatory" : "+ Set Mandatory"}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setVideoForm(vid);
                              setShowVideoModal(true);
                            }}
                            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 font-bold text-xs"
                          >
                            ✏️ แก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteVideo(vid.id)}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50 font-bold text-xs"
                          >
                            🗑️ ลบ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Exam Builder */}
            {activeTab === "exam" && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Exam Builder (สร้างโจทย์ข้อสอบ)</h2>
                    <p className="text-xs text-gray-500">
                      สร้างคำถามและตัวเลือก (ผู้สมัครจะไม่เห็นเฉลยคำตอบในหน้าสอบ เพื่อป้องกันการเจาะ DevTools)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setQForm({
                        id: crypto.randomUUID(),
                        project_id: selectedProjectId,
                        prompt: "",
                        type: "mcq",
                        options: ["ตัวเลือก 1", "ตัวเลือก 2", "ตัวเลือก 3", "ตัวเลือก 4"],
                        correct_answer: "1",
                        model_answer: "",
                        points: 1,
                      });
                      setIsEditingQ(false);
                      setShowQuestionModal(true);
                    }}
                    className="px-5 py-2.5 rounded-full bg-[var(--accent-red)] text-white text-sm font-bold shadow hover:bg-red-700"
                  >
                    + เพิ่มคำถามใหม่
                  </button>
                </div>

                {projectQuestions.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 bg-gray-50 rounded-2xl border border-dashed">
                    ยังไม่มีข้อสอบในวิชานี้ กด “+ เพิ่มคำถามใหม่” เพื่อสร้างข้อสอบ
                  </div>
                ) : (
                  <div className="space-y-6">
                    {projectQuestions.map((q, idx) => (
                      <div key={q.id} className="p-6 rounded-2xl border border-gray-200 bg-white shadow-xs">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-full bg-blue-100 text-[var(--primary-blue)] font-bold text-sm flex items-center justify-center">
                              {idx + 1}
                            </span>
                            <span
                              className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${
                                q.type === "mcq"
                                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}
                            >
                              {q.type === "mcq" ? "Multiple Choice (MCQ)" : "Open-ended (อัตนัย)"}
                            </span>
                            <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-md">
                              {q.points || 1} คะแนน
                            </span>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setQForm({
                                  id: q.id,
                                  project_id: q.project_id || selectedProjectId,
                                  prompt: q.prompt,
                                  type: q.type,
                                  options: q.options && q.options.length > 0 ? q.options : ["ตัวเลือก 1", "ตัวเลือก 2"],
                                  correct_answer: q.correct_answer || "1",
                                  model_answer: q.model_answer || "",
                                  points: q.points || 1,
                                });
                                setIsEditingQ(true);
                                setShowQuestionModal(true);
                              }}
                              className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg"
                            >
                              ✏️ แก้ไขโจทย์
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteQuestion(q.id)}
                              className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg"
                            >
                              🗑️ ลบ
                            </button>
                          </div>
                        </div>

                        <h3 className="text-base font-bold text-gray-800 mb-4 pl-11">{q.prompt}</h3>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Answer Keys & Manual Grading */}
            {activeTab === "keys" && (
              <div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-emerald-900 flex items-center gap-2">
                      <span>🔑 Answer Key Configuration (การจัดการเฉลยคำตอบ)</span>
                      <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                        🔒 Backend Secure Only
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      ตั้งค่าเฉลยคำตอบเป็นหมายเลขข้อ (1, 2, 3, 4) เพื่อรองรับการนำเข้า CSV และป้องกันการเปลี่ยนข้อความตัวเลือก
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isGrading}
                    onClick={() => void handleTriggerGrading()}
                    className="px-6 py-2.5 rounded-full bg-emerald-600 text-white font-bold text-sm shadow hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {isGrading ? "กำลังประมวลผล..." : "⚡ เริ่มตรวจคำตอบ (Grade Exams Now)"}
                  </button>
                </div>

                {/* Section A: Flexible CSV File Upload */}
                <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-200 mb-8">
                  <h3 className="font-bold text-emerald-900 text-base mb-2">📁 อัปโหลดเฉลยคำตอบผ่านไฟล์ CSV</h3>
                  <p className="text-xs text-gray-600 mb-4">
                    รูปแบบ CSV 2 คอลัมน์: <code>ลำดับข้อ,หมายเลขตัวเลือก</code> (ตัวอย่าง: <code>1,2</code> หรือ <code>2,4</code> หรือ <code>3,1</code>)
                  </p>

                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleFileUpload}
                      className="text-xs file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer"
                    />

                    {csvParsed.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleApplyCsvAnswerKeys()}
                        className="px-5 py-2 rounded-full bg-emerald-800 text-white text-xs font-bold shadow hover:bg-emerald-900"
                      >
                        ยืนยันการนำเข้าเฉลย ({csvParsed.length} ข้อ)
                      </button>
                    )}
                  </div>

                  {/* CSV Preview Table */}
                  {csvParsed.length > 0 && (
                    <div className="mt-4 bg-white rounded-xl border border-emerald-200 p-4 max-h-48 overflow-y-auto">
                      <h4 className="text-xs font-bold text-emerald-800 mb-2">ตัวอย่างข้อมูลเฉลยจาก CSV:</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {csvParsed.map((item, idx) => (
                          <div key={idx} className="p-2 bg-gray-50 rounded border flex justify-between">
                            <span className="font-mono text-gray-500">ข้อที่ {item.questionIdOrOrder}:</span>
                            <span className="font-bold text-emerald-700">ตัวเลือกที่ {item.correctAnswer}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Section B: Manual Entry Form per Question */}
                <h3 className="font-bold text-gray-800 text-lg mb-4">📝 กำหนดเฉลยคำตอบรายข้อ (Manual Answer Key Entry)</h3>
                <div className="space-y-4">
                  {projectQuestions.map((q, idx) => {
                    const selectedChoice = (() => {
                      if (!q.correct_answer) return "";
                      if (/^\d+$/.test(q.correct_answer)) return q.correct_answer;
                      const matchIdx = q.options?.indexOf(q.correct_answer);
                      return matchIdx !== undefined && matchIdx >= 0 ? String(matchIdx + 1) : q.correct_answer;
                    })();

                    return (
                      <div key={q.id} className="p-5 rounded-2xl border border-gray-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm text-[var(--primary-blue)]">ข้อที่ {idx + 1} ({q.id})</span>
                            <span className="text-xs text-gray-400">[{q.type.toUpperCase()}]</span>
                          </div>
                          <p className="text-sm font-semibold text-gray-700">{q.prompt}</p>
                        </div>

                        <div className="w-full md:w-72 shrink-0">
                          <label className="block text-xs font-bold text-emerald-900 mb-1">เฉลยคำตอบ (Correct Choice):</label>
                          {q.type === "mcq" && q.options && q.options.length > 0 ? (
                            <select
                              className={`${inputClass} text-xs font-bold text-emerald-800 border-emerald-300 bg-emerald-50/50`}
                              value={selectedChoice}
                              onChange={(e) => {
                                const val = e.target.value;
                                void saveProjectQuestion({ ...q, correct_answer: val });
                                showStatus(`อัปเดตเฉลยข้อ ${idx + 1} เป็นตัวเลือกที่ ${val}`);
                              }}
                            >
                              <option value="">-- เลือกเฉลยคำตอบ --</option>
                              {q.options.map((opt, optIdx) => (
                                <option key={optIdx} value={String(optIdx + 1)}>
                                  ตัวเลือกที่ {optIdx + 1}: {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              className={`${inputClass} text-xs border-emerald-300`}
                              placeholder="กรอกคำตอบเฉลย..."
                              value={q.correct_answer || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                void saveProjectQuestion({ ...q, correct_answer: val });
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Project Add/Edit Schedule */}
      {showProjectModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-4">
              {isEditingProj ? "แก้ไขข้อมูล & กำหนดการวิชา" : "สร้างวิชา/โครงการใหม่"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Project ID (รหัสโครงการ):</label>
                <input
                  type="text"
                  disabled={isEditingProj}
                  className={`${inputClass} font-mono`}
                  placeholder="e.g. ict-talent-2026"
                  value={projForm.id}
                  onChange={(e) => setProjForm((prev) => ({ ...prev, id: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">ชื่อวิชา / โครงการ:</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. โครงการพัฒนาศักยภาพตัวแทน ICT"
                  value={projForm.name}
                  onChange={(e) => setProjForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">คำอธิบายรายละเอียด:</label>
                <textarea
                  className={`${inputClass} min-h-20`}
                  placeholder="คำอธิบายวิชา หรือวัตถุประสงค์ของการทดสอบ"
                  value={projForm.description}
                  onChange={(e) => setProjForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

              {/* Scoring Config */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                <div>
                  <label className="block text-xs font-bold text-[var(--primary-blue)] mb-1">เกณฑ์ผ่าน (Pass Threshold):</label>
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={projForm.pass_threshold ?? 3}
                    onChange={(e) => setProjForm((prev) => ({ ...prev, pass_threshold: parseInt(e.target.value) || 3 }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--primary-blue)] mb-1">คะแนนเต็ม (Max Score):</label>
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-blue-200 text-sm font-bold text-gray-800">
                    <span>{calculatedMaxScore > 0 ? calculatedMaxScore : projForm.max_score || 5} คะแนน</span>
                    <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      คำนวณอัตโนมัติ
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">คำนวณจากผลรวมคะแนนของทุกข้อสอบในวิชานี้</p>
                </div>
              </div>

              {/* Registration Period Controls */}
              <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-100 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-amber-900">ช่วงเวลาเปิดลงทะเบียน (Registration Window):</label>
                  <label className="flex items-center gap-2 text-xs font-bold text-amber-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projForm.reg_enabled ?? true}
                      onChange={(e) => setProjForm((prev) => ({ ...prev, reg_enabled: e.target.checked }))}
                      className="accent-amber-600"
                    />
                    เปิดรับสมัคร
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span>วันเริ่มต้น:</span>
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={projForm.reg_start ? projForm.reg_start.slice(0, 16) : ""}
                      onChange={(e) => setProjForm((prev) => ({ ...prev, reg_start: e.target.value }))}
                    />
                  </div>
                  <div>
                    <span>วันสิ้นสุด:</span>
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={projForm.reg_end ? projForm.reg_end.slice(0, 16) : ""}
                      onChange={(e) => setProjForm((prev) => ({ ...prev, reg_end: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Exam Period Controls */}
              <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-purple-900">ช่วงเวลาเปิดทำข้อสอบ (Exam Window):</label>
                  <label className="flex items-center gap-2 text-xs font-bold text-purple-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projForm.exam_enabled ?? true}
                      onChange={(e) => setProjForm((prev) => ({ ...prev, exam_enabled: e.target.checked }))}
                      className="accent-purple-600"
                    />
                    เปิดระบบสอบ
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span>วันเริ่มต้น:</span>
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={projForm.exam_start ? projForm.exam_start.slice(0, 16) : ""}
                      onChange={(e) => setProjForm((prev) => ({ ...prev, exam_start: e.target.value }))}
                    />
                  </div>
                  <div>
                    <span>วันสิ้นสุด:</span>
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={projForm.exam_end ? projForm.exam_end.slice(0, 16) : ""}
                      onChange={(e) => setProjForm((prev) => ({ ...prev, exam_end: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                className="px-5 py-2.5 rounded-full border text-sm font-bold text-gray-600"
                onClick={() => setShowProjectModal(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="px-6 py-2.5 rounded-full bg-[var(--primary-blue)] text-white text-sm font-bold shadow"
                onClick={() => void handleSaveProject()}
              >
                บันทึกโครงการ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Video Add/Edit */}
      {showVideoModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl border border-gray-100">
            <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-4">เพิ่ม/แก้ไขวิดีโอบทเรียน</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">ชื่อคลิปบทเรียน:</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. บทเรียนที่ 1: ความรู้พื้นฐานเกี่ยวกับ ICT"
                  value={videoForm.title}
                  onChange={(e) => setVideoForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">ลิงก์วิดีโอ (YouTube URL):</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={videoForm.video_url}
                  onChange={(e) => setVideoForm((prev) => ({ ...prev, video_url: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-200">
                <input
                  type="checkbox"
                  id="mandatory-check"
                  className="w-5 h-5 accent-amber-600 rounded cursor-pointer"
                  checked={videoForm.is_mandatory}
                  onChange={(e) => setVideoForm((prev) => ({ ...prev, is_mandatory: e.target.checked }))}
                />
                <label htmlFor="mandatory-check" className="text-xs font-bold text-amber-900 cursor-pointer">
                  Mandatory for Exam (กำหนดให้เป็นวิดีโอบังคับประจำวิชานี้)
                </label>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                className="px-5 py-2.5 rounded-full border text-sm font-bold text-gray-600"
                onClick={() => setShowVideoModal(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="px-6 py-2.5 rounded-full bg-[var(--primary-blue)] text-white text-sm font-bold shadow"
                onClick={() => void handleSaveVideo()}
              >
                บันทึกวิดีโอ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Question Builder Add/Edit */}
      {showQuestionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-4">
              {isEditingQ ? "แก้ไขคำถาม" : "สร้างคำถามในคลังข้อสอบ"}
            </h3>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">ประเภทข้อสอบ:</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setQForm((prev) => ({ ...prev, type: "mcq" }))}
                    className={`py-3 rounded-2xl border font-bold text-xs text-center transition-all ${
                      qForm.type === "mcq"
                        ? "border-purple-600 bg-purple-50 text-purple-800 shadow-sm"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Multiple Choice (ปรนัย เลือกคำตอบ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setQForm((prev) => ({ ...prev, type: "open_ended" }))}
                    className={`py-3 rounded-2xl border font-bold text-xs text-center transition-all ${
                      qForm.type === "open_ended"
                        ? "border-amber-600 bg-amber-50 text-amber-800 shadow-sm"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Open-ended (อัตนัย ตอบคำถาม)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">โจทย์ / คำถาม:</label>
                <textarea
                  className={`${inputClass} min-h-20`}
                  placeholder="กรอกโจทย์คำถาม..."
                  value={qForm.prompt}
                  onChange={(e) => setQForm((prev) => ({ ...prev, prompt: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">คะแนนเต็มของข้อนี้:</label>
                <input
                  type="number"
                  min="1"
                  className={`${inputClass} max-w-32`}
                  value={qForm.points}
                  onChange={(e) => setQForm((prev) => ({ ...prev, points: parseInt(e.target.value) || 1 }))}
                />
              </div>

              {qForm.type === "mcq" && (
                <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-purple-900">ตัวเลือกคำตอบ:</label>
                    <button
                      type="button"
                      onClick={() =>
                        setQForm((prev) => ({
                          ...prev,
                          options: [...prev.options, `ตัวเลือกที่ ${prev.options.length + 1}`],
                        }))
                      }
                      className="text-xs font-bold text-purple-700 hover:underline"
                    >
                      + เพิ่มตัวเลือก
                    </button>
                  </div>

                  <div className="space-y-2">
                    {qForm.options.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          className={inputClass}
                          value={opt}
                          onChange={(e) => {
                            const val = e.target.value;
                            setQForm((prev) => {
                              const nextOpts = [...prev.options];
                              nextOpts[idx] = val;
                              return { ...prev, options: nextOpts };
                            });
                          }}
                        />
                        {qForm.options.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setQForm((prev) => ({
                                ...prev,
                                options: prev.options.filter((_, i) => i !== idx),
                              }))
                            }
                            className="text-red-500 hover:text-red-700 font-bold px-2"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                className="px-5 py-2.5 rounded-full border text-sm font-bold text-gray-600"
                onClick={() => setShowQuestionModal(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="px-6 py-2.5 rounded-full bg-[var(--primary-blue)] text-white text-sm font-bold shadow"
                onClick={() => void handleSaveQuestion()}
              >
                บันทึกคำถาม
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Grading Results */}
      {gradingResult && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl border border-gray-100 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 text-3xl font-extrabold flex items-center justify-center mx-auto mb-4">
              ✓
            </div>
            <h3 className="text-2xl font-extrabold text-gray-800 mb-2">ตรวจข้อสอบเรียบร้อยแล้ว</h3>
            <p className="text-gray-500 text-sm mb-6">ผลการประมวลผลคำตอบผู้สอบวิชา {currentProject.name}</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="text-2xl font-extrabold text-gray-800">{gradingResult.gradedCount}</div>
                <div className="text-xs text-gray-500 font-semibold mt-1">ผู้เข้าสอบทั้งหมด</div>
              </div>
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                <div className="text-2xl font-extrabold text-emerald-700">{gradingResult.passedCount}</div>
                <div className="text-xs text-emerald-800 font-semibold mt-1">ผู้ที่สอบผ่านเกณฑ์</div>
              </div>
            </div>

            <button
              type="button"
              className="w-full py-3 rounded-full bg-emerald-600 text-white font-bold text-sm shadow hover:bg-emerald-700"
              onClick={() => setGradingResult(null)}
            >
              ตกลง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectsManagementPage() {
  return (
    <AuthGuard requireAdmin>
      <ProjectsManagementContent />
    </AuthGuard>
  );
}
