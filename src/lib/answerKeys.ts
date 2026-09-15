import { groupQuestionsBySection } from "@/lib/examSections";
import type { ExamSection, ProjectQuestion, QuestionType } from "@/types/ict";

export type AnswerKeyPreviewStatus = "ok" | "error" | "skip";

export type AnswerKeyPreviewRow = {
  line: number;
  questionId?: string;
  questionCode?: string;
  displayNumber?: number;
  prompt?: string;
  type?: QuestionType;
  rawAnswer: string;
  storedAnswer?: string;
  status: AnswerKeyPreviewStatus;
  message: string;
};

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const QUESTION_CODE_RE = /^Q(\d+)$/i;
const SEQUENTIAL_ID_RE = /^(?:question|ข้อ)?\s*\d{1,4}$/i;

export function formatQuestionCode(sequence: number): string {
  return `Q${String(Math.max(1, sequence)).padStart(3, "0")}`;
}

export function parseQuestionCode(value: string): number | null {
  const match = value.trim().match(QUESTION_CODE_RE);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

export function isFormattedQuestionCode(value: string): boolean {
  return parseQuestionCode(value) !== null;
}

export function permanentQuestionCode(question: { question_code?: string | null }): string {
  const sequence = parseQuestionCode(question.question_code || "");
  return sequence === null ? "" : formatQuestionCode(sequence);
}

export function nextQuestionCode(questions: { question_code?: string | null }[]): string {
  const max = questions.reduce((highest, question) => {
    const sequence = parseQuestionCode(question.question_code || "");
    return sequence !== null && sequence > highest ? sequence : highest;
  }, 0);
  return formatQuestionCode(max + 1);
}

export function canonicalMcqValue(value: string, options: string[]): string | null {
  const trimmed = value.trim();
  if (!trimmed || options.length === 0) return null;
  const exact = options.find((option) => option.trim() === trimmed);
  if (exact) return exact.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    if (index >= 1 && index <= options.length) return options[index - 1].trim();
  }
  if (/^[A-Za-z]$/.test(trimmed)) {
    const index = trimmed.toUpperCase().charCodeAt(0) - 64;
    if (index >= 1 && index <= options.length) return options[index - 1].trim();
  }
  return null;
}

export function answersMatch(
  question: Pick<ProjectQuestion, "type" | "options">,
  userAnswer: string,
  keyAnswer: string
): boolean {
  const user = userAnswer.trim();
  const key = keyAnswer.trim();
  if (!user || !key) return false;
  if (user === key) return true;
  if (question.type !== "mcq" || !question.options?.length) return false;
  const userChoice = canonicalMcqValue(user, question.options);
  const keyChoice = canonicalMcqValue(key, question.options);
  return Boolean(userChoice && keyChoice && userChoice === keyChoice);
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isComment(cells: string[]): boolean {
  return cells[0]?.trim().startsWith("#") ?? false;
}

type Columns = {
  id: number;
  code: number;
  answer: number;
  type: number;
};

function detectColumns(header: string[]): Columns | null {
  const keys = header.map(headerKey);
  const find = (...names: string[]) => keys.findIndex((key) => names.includes(key));
  const answer = find("answer", "correct_answer", "correctanswer", "เฉลย", "คำตอบ");
  const id = find("question_id", "questionid", "id");
  const code = find("question_code", "questioncode", "code", "รหัสข้อ");
  if (answer < 0) {
    if (id < 0 && code < 0) return null;
    // Header without explicit answer column: last column is the answer.
    return {
      id,
      code,
      answer: header.length - 1,
      type: find("type", "question_type", "ประเภท"),
    };
  }
  if (id < 0 && code < 0) return null;
  return { id, code, answer, type: find("type", "question_type", "ประเภท") };
}

function csvType(value: string): QuestionType | null {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  if (["mcq", "choice", "multiple_choice", "ปรนัย"].includes(key)) return "mcq";
  if (["open_ended", "open", "subjective", "text", "อัตนัย", "ข้อความ"].includes(key)) return "open_ended";
  if (key === "short") return "short";
  return null;
}

function isOpenEnded(type: QuestionType): boolean {
  return type === "open_ended" || type === "short";
}

function isSequentialToken(value: string): boolean {
  const token = value.trim();
  if (!token || UUID_RE.test(token) || isFormattedQuestionCode(token)) return false;
  return SEQUENTIAL_ID_RE.test(token);
}

function sameQuestion(a: ProjectQuestion, b: ProjectQuestion): boolean {
  return a.id === b.id;
}

function findById(questions: ProjectQuestion[], raw: string): ProjectQuestion | undefined {
  const token = raw.trim().toLowerCase().replace(/-/g, "");
  return questions.find((question) => question.id.toLowerCase().replace(/-/g, "") === token);
}

function findByCode(questions: ProjectQuestion[], raw: string): ProjectQuestion | undefined {
  const sequence = parseQuestionCode(raw);
  if (sequence === null) return undefined;
  return questions.find((question) => parseQuestionCode(question.question_code || "") === sequence);
}

function typeLabel(type: QuestionType): string {
  return type === "mcq" ? "ปรนัย" : "อัตนัย";
}

export function previewAnswerKeyCsv(
  csvText: string,
  questions: ProjectQuestion[],
  sections: ExamSection[] = []
): AnswerKeyPreviewRow[] {
  const numbered = new Map(
    groupQuestionsBySection(questions, sections)
      .flatMap((part) => part.questions)
      .map((question) => [question.id, question.globalNumber])
  );
  const rows = parseCsv(csvText).filter((cells) => !isComment(cells));
  if (rows.length === 0) {
    return [{ line: 1, rawAnswer: "", status: "error", message: "ไฟล์ว่าง ไม่พบแถวข้อมูล" }];
  }

  let dataRows = rows;
  const columns: Columns | null = detectColumns(rows[0]);
  let startLine = 1;
  if (columns) {
    dataRows = rows.slice(1);
    startLine = 2;
  }

  const seen = new Set<string>();
  return dataRows.map((cells, index) => {
    const line = startLine + index;
    const rawId = columns && columns.id >= 0 ? (cells[columns.id] || "").trim() : (cells[0] || "").trim();
    const rawCode = columns && columns.code >= 0 ? (cells[columns.code] || "").trim() : "";
    const rawAnswer = (columns ? cells[columns.answer] || "" : cells.slice(1).join(",")).trim();
    const declaredType = columns && columns.type >= 0 ? csvType(cells[columns.type] || "") : null;
    const declaredRaw = columns && columns.type >= 0 ? (cells[columns.type] || "").trim() : "";

    if (!rawId && !rawCode && !rawAnswer) {
      return { line, rawAnswer, status: "skip" as const, message: "แถวว่าง" };
    }

    const identity = rawId || rawCode;
    if (!columns && isSequentialToken(identity)) {
      return {
        line,
        rawAnswer,
        status: "error" as const,
        message: "ใช้เลขลำดับข้อ (เช่น 1) ซึ่งเปลี่ยนเมื่อย้ายส่วนหรือข้อ กรุณาใช้ question_id หรือรหัส Q001",
      };
    }
    if ((rawId && isSequentialToken(rawId)) || (rawCode && isSequentialToken(rawCode) && !findByCode(questions, rawCode))) {
      return {
        line,
        rawAnswer,
        status: "error" as const,
        message: `ไม่จับคู่ด้วยเลขลำดับ "${identity}" กรุณาใช้ question_id หรือรหัส Q001`,
      };
    }

    const idColumn = Boolean(columns && columns.id >= 0);
    const codeColumn = Boolean(columns && columns.code >= 0);
    const byId = rawId ? findById(questions, rawId) : undefined;
    const byCode = rawCode
      ? findByCode(questions, rawCode)
      : !idColumn && rawId
        ? findByCode(questions, rawId)
        : undefined;
    if (idColumn && rawId && !byId) {
      return { line, rawAnswer, status: "error" as const, message: `ไม่พบ question_id "${rawId}"` };
    }
    if (codeColumn && rawCode && !byCode) {
      return { line, rawAnswer, status: "error" as const, message: `ไม่พบ question_code "${rawCode}"` };
    }
    if (!byId && !byCode) {
      return { line, rawAnswer, status: "error" as const, message: `ไม่พบ question_id หรือ question_code "${identity}"` };
    }
    if (byId && byCode && !sameQuestion(byId, byCode)) {
      return {
        line,
        rawAnswer,
        status: "error" as const,
        message: "question_id และ question_code ไม่ได้ชี้ไปที่ข้อเดียวกัน",
      };
    }

    const question = byId || byCode;
    if (!question) {
      return { line, rawAnswer, status: "error" as const, message: "ไม่พบข้อสอบจากรหัสถาวร" };
    }
    if (seen.has(question.id)) {
      return {
        line,
        questionId: question.id,
        questionCode: permanentQuestionCode(question),
        displayNumber: numbered.get(question.id),
        prompt: question.prompt,
        type: question.type,
        rawAnswer,
        status: "error" as const,
        message: "รหัสข้อนี้ซ้ำในไฟล์",
      };
    }
    seen.add(question.id);

    if (declaredRaw && !declaredType) {
      return rowError(line, question, numbered, rawAnswer, `ไม่รู้จักประเภท "${declaredRaw}"`);
    }
    if (declaredType && declaredType !== question.type && !(isOpenEnded(declaredType) && isOpenEnded(question.type))) {
      return rowError(
        line,
        question,
        numbered,
        rawAnswer,
        `ประเภทในไฟล์เป็น${typeLabel(declaredType)} แต่ข้อนี้เป็น${typeLabel(question.type)}`
      );
    }
    if (!rawAnswer) {
      return {
        line,
        questionId: question.id,
        questionCode: permanentQuestionCode(question),
        displayNumber: numbered.get(question.id),
        prompt: question.prompt,
        type: question.type,
        rawAnswer,
        status: "skip" as const,
        message: "ยังไม่กำหนดเฉลย — เว้นว่างได้ และจะไม่ลบเฉลยเดิมถ้ามีอยู่แล้ว",
      };
    }

    if (question.type === "mcq") {
      const options = question.options || [];
      if (options.length === 0) {
        return rowError(line, question, numbered, rawAnswer, "ข้อปรนัยนี้ยังไม่มีตัวเลือก");
      }
      const stored = canonicalMcqValue(rawAnswer, options);
      if (!stored) {
        return rowError(
          line,
          question,
          numbered,
          rawAnswer,
          "ข้อปรนัยรับได้เฉพาะเลขตัวเลือก (1, 2) ตัวอักษร (A, B) หรือข้อความตัวเลือกตรง ๆ ไม่รับข้อความอิสระ"
        );
      }
      return {
        line,
        questionId: question.id,
        questionCode: permanentQuestionCode(question),
        displayNumber: numbered.get(question.id),
        prompt: question.prompt,
        type: question.type,
        rawAnswer,
        storedAnswer: stored,
        status: "ok" as const,
        message: ``,
      };
    }

    return {
      line,
      questionId: question.id,
      questionCode: permanentQuestionCode(question),
      displayNumber: numbered.get(question.id),
      prompt: question.prompt,
      type: question.type,
      rawAnswer,
      storedAnswer: rawAnswer,
      status: "ok" as const,
      message: "",
    };
  });
}

function rowError(
  line: number,
  question: ProjectQuestion,
  numbered: Map<string, number>,
  rawAnswer: string,
  message: string
): AnswerKeyPreviewRow {
  return {
    line,
    questionId: question.id,
    questionCode: permanentQuestionCode(question),
    displayNumber: numbered.get(question.id),
    prompt: question.prompt,
    type: question.type,
    rawAnswer,
    status: "error",
    message,
  };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildAnswerKeyTemplate(questions: ProjectQuestion[], sections: ExamSection[] = []): string {
  const lines = [
    "# ใช้ question_code รูปแบบ Q001 เป็นหลัก (หรือ question_id) ห้ามใช้เลขลำดับข้อ ช่อง answer เว้นว่างได้",
    "question_code,type,answer",
  ];
  for (const part of groupQuestionsBySection(questions, sections)) {
    for (const question of part.questions) {
      lines.push(
        [
          permanentQuestionCode(question) || "",
          question.type,
          "",
        ].map(csvCell).join(",")
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
