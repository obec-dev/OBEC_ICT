/** Turn scheme-less URLs (www.example.com) into absolute https links. */
export function normalizeExternalUrl(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  const stripped = v.replace(/^\/+/, "");
  if (!stripped) return "";
  return `https://${stripped}`;
}
