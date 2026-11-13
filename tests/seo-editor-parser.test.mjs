import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionMarkdown, parseBriefMarkdown } from "../lib/seo-editor/brief-parser.ts";

const sample = `# ТЗ для страницы: аренда авто пхукет

Работайте по зонам: сначала исправляйте фразы, затем отдельные леммы.

## Общее — Весь видимый документ

### Фразы
- [ ] Добавить фразы **аренда машины**: сейчас 0, ориентир 16 (диапазон 10–20).
- [ ] Добавить фразы **дольше срок**: сейчас 0, ориентир 3 (диапазон 1–6).
- [ ] Снизить количество вхождений фразы **арендовать автомобиль**: сейчас 6, ориентир 3 (диапазон 1–5).

### Леммы
- [ ] Добавить леммы **акпп**: сейчас 0, ориентир 76 (диапазон 1–184).
- [ ] Добавить леммы **1\\.5**: сейчас 0, ориентир 5 (диапазон 1–9).

## H2–H6 — Подзаголовки

### Леммы
- [ ] Добавить леммы **faq**: сейчас 0, ориентир 3 (диапазон 1–5).
`;

test("parses the BAR Markdown brief by zones, kinds and actions", () => {
  const parsed = parseBriefMarkdown(sample);
  assert.equal(parsed.title, "аренда авто пхукет");
  assert.equal(parsed.recommendations.length, 6);
  assert.equal(parsed.recommendations[0].zoneKey, "all");
  assert.equal(parsed.recommendations[0].kind, "phrase");
  assert.equal(parsed.recommendations[0].action, "add");
  assert.equal(parsed.recommendations[2].action, "reduce");
  assert.equal(parsed.recommendations[3].kind, "lemma");
  assert.equal(parsed.recommendations[4].term, "1.5");
  assert.equal(parsed.recommendations[5].zoneKey, "headings");
  assert.equal(parsed.recommendations[5].decision, "review");
});

test("flags awkward fragments and unusually high single-lemma targets for review", () => {
  const parsed = parseBriefMarkdown(sample);
  const fragment = parsed.recommendations.find((row) => row.term === "дольше срок");
  const highTarget = parsed.recommendations.find((row) => row.term === "акпп");
  assert.equal(fragment?.decision, "review");
  assert.match(fragment?.reasons.join(" ") ?? "", /обрывок/u);
  assert.equal(highTarget?.decision, "review");
  assert.match(highTarget?.reasons.join(" ") ?? "", /Высокий ориентир/u);
});

test("exports a decision report without turning BAR targets into mandatory norms", () => {
  const parsed = parseBriefMarkdown(sample);
  const accepted = parsed.recommendations[0];
  accepted.decision = "accepted";
  const report = buildDecisionMarkdown(parsed.title, parsed.recommendations);
  assert.match(report, /Числовые ориентиры БАР рассматриваются как подсказки/u);
  assert.match(report, /Принято к рассмотрению \(1\)/u);
  assert.match(report, /аренда машины/u);
});
