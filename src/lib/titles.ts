export type TitleKey =
  | "mr"
  | "miss"
  | "mrs"
  | "ms"
  | "dr"
  | "asst_prof"
  | "assoc_prof"
  | "prof"
  | "other";

export type TitleOption = {
  key: TitleKey;
  en: string;
  th: string;
};

/** EN and TH titles stay linked via `key` — changing one updates the other. */
export const TITLE_OPTIONS: TitleOption[] = [
  { key: "mr", en: "Mr.", th: "นาย" },
  { key: "miss", en: "Miss", th: "นางสาว" },
  { key: "mrs", en: "Mrs.", th: "นาง" },
  { key: "ms", en: "Ms.", th: "คุณ" },
  { key: "dr", en: "Dr.", th: "ดร." },
  { key: "asst_prof", en: "Asst. Prof.", th: "ผศ." },
  { key: "assoc_prof", en: "Assoc. Prof.", th: "รศ." },
  { key: "prof", en: "Prof.", th: "ศ." },
  { key: "other", en: "Other", th: "อื่นๆ" },
];

export function getTitleByKey(key: TitleKey | ""): TitleOption | undefined {
  if (!key) return undefined;
  return TITLE_OPTIONS.find((t) => t.key === key);
}

/** Allow English letters, spaces, hyphen, apostrophe. */
export function filterEnglishOnly(value: string): string {
  return value.replace(/[^A-Za-z\s\-'.]/g, "");
}

/** Allow Thai characters, spaces, hyphen, apostrophe. */
export function filterThaiOnly(value: string): string {
  return value.replace(/[^\u0E00-\u0E7F\s\-'.]/g, "");
}

export const ENG_NAME_RE = /^[A-Za-z\s\-'.]+$/;
export const THAI_NAME_RE = /^[\u0E00-\u0E7F\s\-'.]+$/;
