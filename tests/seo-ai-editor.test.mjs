import test from "node:test";
import assert from "node:assert/strict";
import { applyExactEdit, isEditableZone, reviewBatch, validateAiEdits } from "../lib/seo-editor/ai-workflow.ts";

const row = (zoneKey, index, decision = "candidate") => ({
  id: `rec-${index}`, zoneKey, decision, term: "аренда авто", kind: "phrase", action: "add",
  current: 0, target: 3, min: 1, max: 5, reasons: [], raw: "", zoneLabel: zoneKey,
});

test("published article scope ignores aggregate page and navigation anchors", () => {
  assert.equal(isEditableZone("all", "publication"), false);
  assert.equal(isEditableZone("anchors", "publication"), false);
  assert.equal(isEditableZone("title", "publication"), true);
  assert.equal(isEditableZone("headings", "publication"), true);
  assert.equal(isEditableZone("all", "site"), true);
});

test("reviewBatch only selects editable, undecided recommendations", () => {
  const rows = [row("all", 1), row("title", 2), row("text", 3, "accepted"), row("anchors", 4), row("headings", 5)];
  assert.deepEqual(reviewBatch(rows, "publication", false, 10).map((r) => r.id), ["rec-2", "rec-5"]);
  assert.deepEqual(reviewBatch(rows, "site", false, 2).map((r) => r.id), ["rec-2", "rec-4"]);
});

test("exact edit is safe and never changes duplicate fragments", () => {
  const article = "В начале указана цена аренды. Второй абзац о страховке.";
  const edit = { find: "В начале указана цена аренды.", replace: "В начале указана полная цена аренды.", reason: "точность", recommendationIds: ["rec-1"] };
  assert.equal(applyExactEdit(article, edit).text, "В начале указана полная цена аренды. Второй абзац о страховке.");
  assert.equal(applyExactEdit("один абзац. один абзац.", { ...edit, find: "один абзац." }).ok, false);
  assert.equal(applyExactEdit("другой текст", edit).ok, false);
});

test("filters model edits that do not exactly match input article", () => {
  const article = "Точный исходный фрагмент для изменения. Второй текст отсутствует.";
  const good = { find: "Точный исходный фрагмент для изменения.", replace: "Улучшенный фрагмент для изменения.", reason: "редактура", recommendationIds: ["rec-7"] };
  assert.deepEqual(validateAiEdits(article, [good, good, { ...good, find: "Несуществующий фрагмент" }, { ...good, recommendationIds: ["rec-12"] }], ["rec-7"]), [good]);
});

test("preserves commercial links and locked keyword-list section", () => {
  const article = "Проверяйте [условия](https://example.test/offer) перед оплатой.\n\n## Ключевые слова\nаренда авто пхукет";
  const unsafeLink = { find: "[условия](https://example.test/offer)", replace: "[условия](https://evil.test/offer)", reason: "ненужно", recommendationIds: ["rec-2"] };
  const unsafeKeyword = { find: "аренда авто пхукет", replace: "прокат авто пхукет", reason: "ненужно", recommendationIds: ["rec-2"] };
  assert.deepEqual(validateAiEdits(article, [unsafeLink, unsafeKeyword], ["rec-2"]), []);
});
