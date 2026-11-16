import type { BriefRecommendation, BriefZoneKey } from "./brief-parser";

export type EditorialScope = "publication" | "site";
export type AiVerdict = "accepted" | "rejected" | "review";
export type AiReview = { id: string; decision: AiVerdict; reason: string; suggestion: string };
export type AiEdit = { find: string; replace: string; reason: string; recommendationIds: string[] };

const PUBLICATION_ZONES = new Set<BriefZoneKey>(["title", "h1", "text", "headings"]);
const SITE_ZONES = new Set<BriefZoneKey>(["title", "h1", "text", "headings", "anchors", "all"]);

export function isEditableZone(zone: BriefZoneKey, scope: EditorialScope, includeAnchors = false): boolean {
  if (scope === "site") return SITE_ZONES.has(zone);
  return PUBLICATION_ZONES.has(zone) || (includeAnchors && zone === "anchors");
}

export function reviewBatch(rows: readonly BriefRecommendation[], scope: EditorialScope, includeAnchors: boolean, limit = 25): BriefRecommendation[] {
  const available = rows.filter((row) => isEditableZone(row.zoneKey, scope, includeAnchors)
    && (row.decision === "candidate" || row.decision === "review"));
  // Zone-specific recommendations are more actionable than aggregate page counts.
  const ranked = scope === "site"
    ? [...available.filter((row) => row.zoneKey !== "all"), ...available.filter((row) => row.zoneKey === "all")]
    : available;
  return ranked.slice(0, limit);
}

export function applyExactEdit(article: string, edit: AiEdit): { ok: boolean; text: string; error?: string } {
  if (!edit.find.trim() || edit.find === edit.replace) return { ok: false, text: article, error: "Пустая замена или текст не изменён." };
  const position = article.indexOf(edit.find);
  if (position < 0) return { ok: false, text: article, error: "Исходный фрагмент уже изменён или не найден." };
  if (article.indexOf(edit.find, position + edit.find.length) !== -1) return { ok: false, text: article, error: "Фрагмент встречается несколько раз. Замену нужно уточнить." };
  return { ok: true, text: article.slice(0, position) + edit.replace + article.slice(position + edit.find.length) };
}

export function validateAiEdits(article: string, edits: readonly AiEdit[], allowedIds: readonly string[]): AiEdit[] {
  const allowed = new Set(allowedIds);
  const usedFind = new Set<string>();
  return edits.filter((edit) => {
    if (!edit || typeof edit.find !== "string" || typeof edit.replace !== "string" || typeof edit.reason !== "string" || !Array.isArray(edit.recommendationIds)) return false;
    if (edit.find.length < 12 || edit.find.length > 3200 || edit.replace.length > 4200 || edit.reason.length > 1200) return false;
    if (usedFind.has(edit.find) || !applyExactEdit(article, edit).ok) return false;
    const sourceUrls = edit.find.match(/https?:\/\/[^\s)]+/gu) ?? [];
    const replacementUrls = edit.replace.match(/https?:\/\/[^\s)]+/gu) ?? [];
    if (JSON.stringify(sourceUrls) !== JSON.stringify(replacementUrls)) return false;
    const keywordSection = article.search(/^## Ключевые слова\s*$/gmu);
    if (keywordSection >= 0 && article.indexOf(edit.find) >= keywordSection) return false;
    if (!edit.recommendationIds.every((id) => typeof id === "string" && allowed.has(id))) return false;
    usedFind.add(edit.find);
    return true;
  });
}
