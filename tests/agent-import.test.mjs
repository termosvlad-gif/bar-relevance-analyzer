import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createAgentHandoff, parseAgentHandoff } from "../lib/agent/bar-import.ts";

const sample = () => ({
  meta: { serpQuery: "аренда авто в турции", snapshotId: "snapshot-test-123", analyzedAt: "2026-11-17T10:00:00Z", queries: ["аренда авто в турции"] },
  summary: { ownWords: 3800 },
  documents: [{ ours: true, url: "https://vc.ru/life/2716804-arenda-avto-v-turcii-dlya-rossiyan", title: "Аренда авто в Турции" }],
  terms: [{ term: "депозит", ownCount: 3 }], ngrams: [{ phrase: "прокат авто" }],
  warnings: [{ name: "competitor", error: "низкое качество" }],
  comparisonProfiles: [{ id: "c1", url: "https://sample.test/" }],
  snapshot: { version: 5, id: "snapshot-test-123", own: { url: "https://vc.ru/life/2716804-arenda-avto-v-turcii-dlya-rossiyan" }, competitors: [{ url: "https://sample.test/" }] },
});

const brief = "# ТЗ для страницы: аренда авто в турции\n\n## Text — Основной текст\n\n### Фразы\n- [ ] Добавить фразы **прокат авто**: сейчас 0, ориентир 1 (диапазон 1–1).";

test("Stage 4.0 preserves the complete BAR report and original Markdown in import JSON", () => {
  const report = sample();
  const job = createAgentHandoff(report, brief, { mode: "url", url: report.documents[0].url, selector: "", text: "" });
  const restored = parseAgentHandoff(JSON.parse(JSON.stringify(job)));
  assert.deepEqual(restored.bar.rawAnalysis, report);
  assert.equal(restored.bar.markdownBrief, brief);
  assert.equal(restored.source.url, report.documents[0].url);
  assert.equal(restored.bar.rawAnalysis.snapshot.competitors.length, 1);
  assert.equal(restored.bar.rawAnalysis.warnings.length, 1);
  assert.match(restored.jobId, /^bar-snapshot-test-123-/);
});

test("Stage 4.0 rejects malformed and partial BAR reports instead of fabricating evidence", () => {
  const report = sample();
  const handoff = createAgentHandoff(report, brief, { mode: "url", url: report.documents[0].url, selector: "", text: "" });
  assert.throws(() => parseAgentHandoff({ ...handoff, bar: { ...handoff.bar, rawAnalysis: { meta: report.meta } } }), /полного результата БАР/);
  assert.throws(() => parseAgentHandoff({ ...handoff, source: { ...handoff.source, text: 42 } }), /исходной страницы/);
  assert.throws(() => parseAgentHandoff({ ...handoff, version: 2 }), /Неверный формат/);
  assert.throws(() => parseAgentHandoff({ ...handoff, bar: { ...handoff.bar, rawAnalysis: { ...report, meta: { ...report.meta, queries: "invalid" } } } }), /полного результата БАР/);
});

test("Stage 4.0 has a separate agent UI and does not alter BAR formulas", async () => {
  const [ui, analyzer, core, route] = await Promise.all([
    readFile(new URL("../app/agent/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/semantic-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/agent/article/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /Полный текст статьи загружен/);
  assert.match(ui, /parseBriefMarkdown/);
  assert.match(analyzer, /Передать агенту →/);
  assert.match(core, /export async function extractAgentSourceArticle/);
  assert.match(route, /"vc.ru", "www.vc.ru"/);
  assert.doesNotMatch(route, /search-competitors|analyzePayload|XMLRiver/);
});

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}
const environment = () => ({ ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } });
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

test("Stage 4.0 serves /agent and rejects extraction of non-VC URLs without network access", async () => {
  const worker = await loadWorker();
  const rendered = await worker.fetch(new Request("http://localhost/agent", { headers: { accept: "text/html" } }), environment(), context());
  assert.equal(rendered.status, 200);
  const html = await rendered.text();
  assert.match(html, /ИИ-агент контент-фабрики/);
  const invalid = await worker.fetch(new Request("http://localhost/api/agent/article", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/" }),
  }), environment(), context());
  assert.equal(invalid.status, 400);
  const result = await invalid.json();
  assert.match(result.error, /vc\.ru/);
});
