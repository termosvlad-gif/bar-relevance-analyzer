/** Stage 4.0 transport only. BAR's statistical report remains immutable. */
export const AGENT_TRANSFER_KEY = "bar:agent:handoff:v1";

export type BarAgentReport = {
  meta: { serpQuery: string; analyzedAt: string; snapshotId: string; queries?: string[] };
  summary: unknown;
  documents: unknown[];
  terms: unknown[];
  ngrams: unknown[];
  snapshot: unknown;
};

export type AgentSource = {
  mode: "url" | "text";
  url: string;
  selector: string;
  text: string;
};

export type AgentHandoff = {
  version: 1;
  jobId: string;
  createdAt: string;
  source: AgentSource;
  bar: {
    /** The entire original BAR response, including competitor snapshot. */
    rawAnalysis: BarAgentReport;
    markdownBrief: string;
  };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAgentHandoff(report: BarAgentReport, markdownBrief: string, source: AgentSource): AgentHandoff {
  const snapshotId = report.meta.snapshotId;
  return {
    version: 1,
    jobId: `bar-${snapshotId}-${report.meta.analyzedAt.replace(/[^0-9]/gu, "")}`,
    createdAt: new Date().toISOString(),
    source: { ...source },
    bar: { rawAnalysis: report, markdownBrief },
  };
}

/** Validate the shape of imported files; never silently fill missing report fields. */
export function parseAgentHandoff(input: unknown): AgentHandoff {
  if (!record(input) || input.version !== 1 || typeof input.jobId !== "string" || input.jobId.length < 6 || input.jobId.length > 180
    || typeof input.createdAt !== "string" || !record(input.source) || !record(input.bar)) {
    throw new Error("Неверный формат передачи БАР (требуется Stage 4.0, версия 1).");
  }
  const source = input.source;
  if ((source.mode !== "url" && source.mode !== "text")
    || typeof source.url !== "string" || source.url.length > 2_048
    || typeof source.selector !== "string" || source.selector.length > 300
    || typeof source.text !== "string" || source.text.length > 200_000) {
    throw new Error("В передаче БАР повреждены данные исходной страницы.");
  }
  const bar = input.bar;
  const raw = bar.rawAnalysis;
  if (!record(raw) || !record(raw.meta) || typeof raw.meta.serpQuery !== "string" || !raw.meta.serpQuery.trim()
    || typeof raw.meta.analyzedAt !== "string" || typeof raw.meta.snapshotId !== "string"
    || (raw.meta.queries !== undefined && (!Array.isArray(raw.meta.queries)
      || raw.meta.queries.some((query: unknown) => typeof query !== "string")))
    || !record(raw.snapshot) || raw.snapshot.version !== 5 || !record(raw.snapshot.own)
    || !Array.isArray(raw.snapshot.competitors)
    || !record(raw.summary) || !Array.isArray(raw.documents) || !raw.documents.length
    || !Array.isArray(raw.terms) || !Array.isArray(raw.ngrams)
    || typeof bar.markdownBrief !== "string" || !bar.markdownBrief.startsWith("# ТЗ для страницы:")
    || bar.markdownBrief.length > 2_000_000) {
    throw new Error("В файле нет полного результата БАР, snapshot v5 или исходного Markdown-ТЗ.");
  }
  return input as AgentHandoff;
}
