export type BriefZoneKey = "all" | "title" | "h1" | "text" | "headings" | "anchors" | "unknown";
export type RecommendationKind = "phrase" | "lemma";
export type RecommendationAction = "add" | "reduce";
export type RecommendationDecision = "candidate" | "review" | "accepted" | "rejected";

export type BriefRecommendation = {
  id: string;
  zoneKey: BriefZoneKey;
  zoneLabel: string;
  kind: RecommendationKind;
  action: RecommendationAction;
  term: string;
  current: number;
  target: number;
  min: number;
  max: number;
  raw: string;
  decision: RecommendationDecision;
  reasons: string[];
};

export type ParsedBrief = {
  title: string;
  recommendations: BriefRecommendation[];
  ignoredLines: number;
  zones: string[];
};

const ROW_RE = /^-\s+\[(?:\s|x|X)\]\s+(Добавить|Снизить количество вхождений)\s+(?:количество вхождений\s+)?(фразы|леммы)\s+\*\*(.+?)\*\*:\s*сейчас\s+(\d+),\s*ориентир\s+(\d+)\s*\(диапазон\s+(\d+)\s*[–—-]\s*(\d+)\)\.?$/iu;
const SHORT_LATIN_CODES = new Set(["en", "ru", "faq", "cx", "br", "zs", "mg"]);
const FRAGMENT_PHRASES = new Map<string, string>([
  ["дольше срок", "Похоже на лемматизированный обрывок. Не вставлять дословно; при необходимости переформулировать."],
  ["входит базовая", "Фраза обрывается до объекта. Нужен естественный контекст, а не буквальное вхождение."],
  ["стоимость входит базовая", "Нарушена грамматическая связь. Не вставлять дословно."],
]);

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()#+\-.!>])/gu, "$1").trim();
}

function zoneFromHeading(heading: string): { key: BriefZoneKey; label: string } {
  const label = heading.split(/\s+[—–-]\s+/u, 1)[0].trim();
  const normalized = label.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  if (normalized === "общее" || normalized === "all") return { key: "all", label };
  if (normalized === "title") return { key: "title", label };
  if (normalized === "h1") return { key: "h1", label };
  if (normalized === "text" || normalized === "текст") return { key: "text", label };
  if (normalized === "h2–h6" || normalized === "h2-h6" || normalized === "h2—h6") return { key: "headings", label };
  if (normalized === "a" || normalized === "anchors") return { key: "anchors", label };
  return { key: "unknown", label: label || "Неизвестная зона" };
}

function classifyForReview(kind: RecommendationKind, term: string, target: number, min: number): string[] {
  const normalized = term.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
  const reasons: string[] = [];
  const tokens = normalized.split(/\s+/u).filter(Boolean);

  const fragmentReason = FRAGMENT_PHRASES.get(normalized);
  if (fragmentReason) reasons.push(fragmentReason);

  if (tokens.length === 1 && /^[a-z0-9.]+$/iu.test(tokens[0]) && SHORT_LATIN_CODES.has(tokens[0])) {
    reasons.push("Короткая латинская аббревиатура. Проверьте, что это самостоятельная сущность, а не технический шум или часть названия модели.");
  }

  if (kind === "lemma" && tokens.length === 1 && target >= 20 && target / Math.max(1, min) >= 3) {
    reasons.push("Высокий ориентир для одной леммы. Не пытайтесь добирать частоту механически; проверьте распределение по конкурентам и смысловую необходимость.");
  }

  if (kind === "phrase" && tokens.length >= 2 && tokens.some((token) => SHORT_LATIN_CODES.has(token))) {
    reasons.push("В фразе есть короткий латинский код. Проверьте точное название модели или сущности.");
  }

  return reasons;
}

export function parseBriefMarkdown(markdown: string): ParsedBrief {
  const lines = markdown.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n");
  const titleLine = lines.find((line) => /^#\s+/u.test(line.trim()))?.trim() ?? "";
  const title = titleLine.replace(/^#\s+/u, "").replace(/^ТЗ для страницы:\s*/iu, "").trim();
  let zone: { key: BriefZoneKey; label: string } = { key: "unknown", label: "Общая зона" };
  let kind: RecommendationKind | null = null;
  let ignoredLines = 0;
  const recommendations: BriefRecommendation[] = [];
  const zones = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      zone = zoneFromHeading(trimmed.slice(3));
      zones.add(zone.label);
      kind = null;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      const heading = trimmed.slice(4).trim().toLocaleLowerCase("ru-RU");
      kind = heading === "фразы" ? "phrase" : heading === "леммы" ? "lemma" : null;
      continue;
    }
    if (!trimmed.startsWith("- [")) continue;

    const match = trimmed.match(ROW_RE);
    if (!match || !kind) {
      ignoredLines += 1;
      continue;
    }

    const action: RecommendationAction = match[1].startsWith("Снизить") ? "reduce" : "add";
    const term = unescapeMarkdown(match[3]);
    const current = Number(match[4]);
    const target = Number(match[5]);
    const min = Number(match[6]);
    const max = Number(match[7]);
    if (!term || ![current, target, min, max].every(Number.isSafeInteger) || min > max) {
      ignoredLines += 1;
      continue;
    }

    const reasons = classifyForReview(kind, term, target, min);
    recommendations.push({
      id: `rec-${recommendations.length + 1}`,
      zoneKey: zone.key,
      zoneLabel: zone.label,
      kind,
      action,
      term,
      current,
      target,
      min,
      max,
      raw: trimmed,
      decision: reasons.length ? "review" : "candidate",
      reasons,
    });
  }

  return { title, recommendations, ignoredLines, zones: [...zones] };
}

export function buildDecisionMarkdown(title: string, rows: readonly BriefRecommendation[]): string {
  const lines = [
    `# Решения по ТЗ БАР${title ? `: ${title}` : ""}`,
    "",
    "Числовые ориентиры БАР рассматриваются как подсказки, а не как обязательные нормы. Решения требуют проверки контекста статьи.",
  ];
  const labels: Record<RecommendationDecision, string> = {
    candidate: "Кандидат на проверку",
    review: "Требует проверки",
    accepted: "Принято к рассмотрению",
    rejected: "Отклонено",
  };
  for (const decision of ["accepted", "review", "candidate", "rejected"] as const) {
    const selected = rows.filter((row) => row.decision === decision);
    if (!selected.length) continue;
    lines.push("", `## ${labels[decision]} (${selected.length})`);
    for (const row of selected) {
      const action = row.action === "add" ? "Добавить" : "Снизить частоту";
      lines.push(`- **${row.term}** — ${action}; зона: ${row.zoneLabel}; сейчас ${row.current}, ориентир ${row.target}, диапазон ${row.min}–${row.max}.`);
      for (const reason of row.reasons) lines.push(`  - Примечание: ${reason}`);
    }
  }
  return lines.join("\n");
}
