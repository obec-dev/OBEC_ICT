import type { ExamSection, ProjectQuestion } from "@/types/ict";

export const UNSECTIONED_ID = "__unsectioned__";

export type NumberedQuestion = ProjectQuestion & { globalNumber: number };

export type ExamPart = {
  id: string;
  title: string;
  description: string;
  order: number;
  questions: NumberedQuestion[];
};

function sortQuestions(questions: ProjectQuestion[]): ProjectQuestion[] {
  return [...questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
}

/** Section order, then question order. Global numbers restart at 1 across the whole exam. */
export function groupQuestionsBySection(
  questions: ProjectQuestion[],
  sections: ExamSection[] = []
): ExamPart[] {
  const bySection = new Map<string, ProjectQuestion[]>();
  for (const question of questions) {
    const id = question.section_id || UNSECTIONED_ID;
    const list = bySection.get(id) ?? [];
    list.push(question);
    bySection.set(id, list);
  }

  const parts: Omit<ExamPart, "questions">[] = [...sections]
    .sort((a, b) => a.section_order - b.section_order || a.title.localeCompare(b.title, "th"))
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description?.trim() || "",
      order: section.section_order,
    }));

  for (const [id, list] of bySection) {
    if (parts.some((part) => part.id === id)) continue;
    const sample = list[0];
    parts.push({
      id,
      title: sample?.section_title?.trim() || (id === UNSECTIONED_ID ? "ยังไม่ระบุส่วน" : "ส่วนข้อสอบ"),
      description: sample?.section_description?.trim() || "",
      order: sample?.section_order ?? 9999,
    });
  }

  parts.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "th"));

  let nextNumber = 1;
  return parts.map((part) => ({
    ...part,
    questions: sortQuestions(bySection.get(part.id) ?? []).map((question) => ({
      ...question,
      globalNumber: nextNumber++,
    })),
  }));
}

export function sectionMeta(sections: ExamSection[], sectionId?: string | null) {
  if (!sectionId) return null;
  return sections.find((section) => section.id === sectionId) ?? null;
}
