"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildDecisionMarkdown,
  parseBriefMarkdown,
  type BriefRecommendation,
  type RecommendationDecision,
} from "@/lib/seo-editor/brief-parser";
import { applyExactEdit, isEditableZone, reviewBatch, type AiEdit, type AiReview, type EditorialScope } from "@/lib/seo-editor/ai-workflow";
import styles from "./editor.module.css";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const IMPORT_BRIEF_KEY = "bar:seo-editor:brief:v1";
const IMPORT_ARTICLE_KEY = "bar:seo-editor:article:v1";
const IMPORT_SOURCE_KEY = "bar:seo-editor:source:v1";

const DECISION_LABELS: Record<RecommendationDecision, string> = {
  candidate: "Кандидат",
  review: "Проверить",
  accepted: "Принять",
  rejected: "Отклонить",
};

const FILTERS: Array<{ value: "all" | RecommendationDecision; label: string }> = [
  { value: "all", label: "Все" },
  { value: "review", label: "Проверить" },
  { value: "candidate", label: "Кандидаты" },
  { value: "accepted", label: "Принятые" },
  { value: "rejected", label: "Отклонённые" },
];

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob(["\ufeff", content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function readMarkdownFile(
  event: ChangeEvent<HTMLInputElement>,
  onRead: (value: string, name: string) => void,
  onError: (message: string) => void,
) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    onError("Файл больше 5 МБ. Для первой версии редактора ограничение составляет 5 МБ.");
    return;
  }
  try {
    onRead(await file.text(), file.name);
    onError("");
  } catch {
    onError(`Не удалось прочитать файл «${file.name}».`);
  }
}

export default function SeoEditorPage() {
  const [article, setArticle] = useState("");
  const [brief, setBrief] = useState("");
  const [articleName, setArticleName] = useState("Статья не загружена");
  const [briefName, setBriefName] = useState("ТЗ не загружено");
  const [rows, setRows] = useState<BriefRecommendation[]>([]);
  const [briefTitle, setBriefTitle] = useState("");
  const [filter, setFilter] = useState<"all" | RecommendationDecision>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scope, setScope] = useState<EditorialScope>("publication");
  const [sourceInfo, setSourceInfo] = useState("");
  const [editorPassword, setEditorPassword] = useState("");
  const [extraRules, setExtraRules] = useState("");
  const [aiBusy, setAiBusy] = useState<"" | "review" | "edit">("");
  const [edits, setEdits] = useState<AiEdit[]>([]);
  const [needsBarCheck, setNeedsBarCheck] = useState(false);
  const [editBatchStart, setEditBatchStart] = useState(0);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const importedBrief = sessionStorage.getItem(IMPORT_BRIEF_KEY);
        const importedArticle = sessionStorage.getItem(IMPORT_ARTICLE_KEY);
        const importedSource = sessionStorage.getItem(IMPORT_SOURCE_KEY);
        if (importedBrief) {
          setBrief(importedBrief);
          setBriefName("ТЗ передано из текущего отчёта БАР");
          sessionStorage.removeItem(IMPORT_BRIEF_KEY);
        }
        if (importedArticle) {
          setArticle(importedArticle);
          setArticleName("Текст передан из текущего отчёта БАР");
          sessionStorage.removeItem(IMPORT_ARTICLE_KEY);
        }
        if (importedSource) {
          try {
            const source = JSON.parse(importedSource) as { mode?: string; url?: string };
            setScope(source.mode === "url" ? "site" : "publication");
            setSourceInfo(source.mode === "url" ? `БАР анализировал URL: ${source.url || "адрес не передан"}. Для правок загрузите редактируемый текст страницы.` : "БАР анализировал вставленный текст.");
          } catch { /* optional provenance only */ }
          sessionStorage.removeItem(IMPORT_SOURCE_KEY);
        }
        if (importedBrief || importedArticle) {
          setNotice("Материалы переданы из БАР. Проверьте их и нажмите «Разобрать ТЗ».");
        }
      } catch {
        setError("Не удалось получить материалы из сессии БАР. Загрузите Markdown-файлы вручную.");
      }
    });
    return () => { active = false; };
  }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    candidate: rows.filter((row) => row.decision === "candidate").length,
    review: rows.filter((row) => row.decision === "review").length,
    accepted: rows.filter((row) => row.decision === "accepted").length,
    rejected: rows.filter((row) => row.decision === "rejected").length,
  }), [rows]);

  const availableCount = useMemo(() => rows.filter((row) => isEditableZone(row.zoneKey, scope)).length, [rows, scope]);
  const pendingReviewCount = useMemo(() => rows.filter((row) => isEditableZone(row.zoneKey, scope) && (row.decision === "candidate" || row.decision === "review")).length, [rows, scope]);
  const selectedForReview = useMemo(() => reviewBatch(rows, scope, false), [rows, scope]);
  const acceptedRows = useMemo(() => rows.filter((row) => row.decision === "accepted" && isEditableZone(row.zoneKey, scope)), [rows, scope]);
  const selectedForEdit = useMemo(() => acceptedRows.slice(editBatchStart, editBatchStart + 25), [acceptedRows, editBatchStart]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) => {
      if (filter !== "all" && row.decision !== filter) return false;
      if (!query) return true;
      return `${row.term} ${row.zoneLabel} ${row.kind}`.toLocaleLowerCase("ru-RU").includes(query);
    });
  }, [rows, filter, search]);

  const handleArticleFile = (event: ChangeEvent<HTMLInputElement>) => {
    void readMarkdownFile(event, (value, name) => {
      setArticle(value);
      setEdits([]);
      setNeedsBarCheck(false);
      setEditBatchStart(0);
      setArticleName(name);
      setNotice(`Статья «${name}» загружена. Содержимое обрабатывается только в браузере.`);
    }, setError);
  };

  const handleBriefFile = (event: ChangeEvent<HTMLInputElement>) => {
    void readMarkdownFile(event, (value, name) => {
      setBrief(value);
      setBriefName(name);
      setRows([]);
      setEdits([]);
      setNeedsBarCheck(false);
      setEditBatchStart(0);
      setNotice(`ТЗ «${name}» загружено. Нажмите «Разобрать ТЗ».`);
    }, setError);
  };

  const parseBrief = () => {
    if (!brief.trim()) {
      setError("Сначала загрузите или вставьте Markdown-ТЗ из БАР.");
      return;
    }
    const parsed = parseBriefMarkdown(brief);
    setRows(parsed.recommendations);
    setEdits([]);
    setNeedsBarCheck(false);
    setEditBatchStart(0);
    setBriefTitle(parsed.title);
    setFilter("all");
    setSearch("");
    setError("");
    setNotice(parsed.recommendations.length
      ? `Разобрано рекомендаций: ${parsed.recommendations.length}. Строк пропущено: ${parsed.ignoredLines}. Предварительные флаги требуют ручной проверки.`
      : "Не удалось найти рекомендации. Проверьте, что загружено ТЗ в формате Markdown из БАР.");
  };

  const requestAi = async (mode: "review" | "edit") => {
    setError(""); setNotice("");
    if (!article.trim() || !rows.length) { setError("Нужны исходный текст статьи и разобранное ТЗ БАР."); return; }
    if (!editorPassword.trim()) { setError("Введите пароль AI-редактора, настроенный в Timeweb (EDITOR_ACCESS_TOKEN)."); return; }
    if (extraRules.length > 14_000) { setError("Дополнительные правила: максимум 14 000 символов."); return; }
    const selection = mode === "review" ? selectedForReview : selectedForEdit;
    if (!selection.length) { setError(mode === "review" ? "Все доступные рекомендации уже разобраны." : "Сначала примите хотя бы одну рекомендацию вручную или через ИИ."); return; }
    setAiBusy(mode);
    try {
      const response = await fetch("/api/editor/assist", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Editor-Token": editorPassword },
        body: JSON.stringify({ mode, article, rows: selection, scope, rules: extraRules }),
      });
      const data = await response.json() as { error?: string; judgments?: AiReview[]; totalRequested?: number; edits?: AiEdit[] };
      if (!response.ok) throw new Error(data.error || "Ошибка запроса к AI-редактору.");
      if (mode === "review") {
        const incoming = new Map((data.judgments ?? []).map((item) => [item.id, item]));
        setRows((current) => current.map((row) => {
          const judgment = incoming.get(row.id);
          return judgment ? { ...row, decision: judgment.decision, aiReason: judgment.reason, aiSuggestion: judgment.suggestion } : row;
        }));
        setNotice(`ИИ обработал ${incoming.size} из ${selection.length} рекомендаций. Проверьте решения и при необходимости измените их вручную.`);
      } else {
        setEdits(data.edits ?? []);
        setNotice((data.edits ?? []).length ? `Подготовлено замен: ${data.edits?.length}. Каждую нужно подтвердить вручную.` : "ИИ не нашёл безопасных точечных замен. Можно выбрать другие рекомендации.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить рекомендации ИИ."); }
    finally { setAiBusy(""); }
  };

  const applyEdit = (index: number) => {
    const edit = edits[index];
    if (!edit) return;
    const result = applyExactEdit(article, edit);
    if (!result.ok) { setError(result.error || "Невозможно применить замену."); return; }
    setArticle(result.text);
    setNeedsBarCheck(true);
    setEdits((current) => current.filter((_, position) => position !== index));
    setError("");
    setNotice("Правка применена к статье. Показатели БАР устарели: проведите повторный анализ после завершения правок.");
  };

  const updateDecision = (id: string, decision: RecommendationDecision) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, decision } : row));
  };

  const exportDecisions = () => {
    if (!rows.length) return;
    const markdown = buildDecisionMarkdown(briefTitle, rows);
    downloadText("bar-editor-decisions.md", markdown);
  };

  const exportArticle = () => {
    if (article.trim()) downloadText("bar-editor-article-revised.md", article);
  };

  const exportAccepted = () => {
    const accepted = rows.filter((row) => row.decision === "accepted");
    if (!accepted.length) return;
    downloadText("bar-editor-accepted-recommendations.md", buildDecisionMarkdown(briefTitle, accepted));
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/analyzer">
          <span className={styles.brandMark}>БАР</span>
          <span><strong>AI SEO EDITOR</strong><small>Интеллектуальная обработка ТЗ</small></span>
        </Link>
        <nav className={styles.headerNav} aria-label="Навигация">
          <Link href="/analyzer">← Анализатор БАР</Link>
          <span className={styles.localBadge}>ЭТАП 2 · ИИ-ПРАВКИ</span>
        </nav>
      </header>

      <div className={styles.shell}>
        <section className={styles.intro}>
          <span className={styles.eyebrow}>SEO WORKSPACE / EDITOR</span>
          <h1>От рекомендаций БАР<br />к осмысленным правкам</h1>
          <p>После анализа URL или текста в БАР передайте ТЗ и статью сюда. ИИ оценит релевантные рекомендации, предложит конкретные замены, а вы решите, какие применить. БАР и его формулы не изменяются.</p>
        </section>

        <section className={styles.inputGrid} aria-label="Исходные материалы">
          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div><span className={styles.step}>01 / МАТЕРИАЛ</span><h2>Исходная статья</h2></div>
              <span className={styles.fileIcon}>MD</span>
            </div>
            <label className={styles.fileButton}>
              <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={handleArticleFile} />
              <span>↑</span> Загрузить Markdown
            </label>
            <div className={styles.fileName}>{articleName}</div>
            <textarea className={styles.textarea} value={article} onChange={(event) => { setArticle(event.target.value); setEdits([]); setNeedsBarCheck(false); }} placeholder="# Заголовок статьи\n\nВставьте сюда исходный текст в Markdown…" spellCheck={false} />
            <div className={styles.panelFoot}><span>{wordCount(article).toLocaleString("ru-RU")} слов</span><span>В ИИ отправляется только после нажатия AI-кнопки</span></div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div><span className={styles.step}>02 / АНАЛИТИКА</span><h2>Техническое задание БАР</h2></div>
              <span className={styles.fileIcon}>MD</span>
            </div>
            <label className={styles.fileButton}>
              <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={handleBriefFile} />
              <span>↑</span> Загрузить ТЗ БАР
            </label>
            <div className={styles.fileName}>{briefName}</div>
            <textarea className={styles.textarea} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="# ТЗ для страницы: ...\n\nВставьте Markdown из блока «ТЗ для страницы» в БАР…" spellCheck={false} />
            <div className={styles.panelFoot}><span>{brief.trim() ? `${brief.trim().split(/\r?\n/u).length.toLocaleString("ru-RU")} строк` : "ТЗ не загружено"}</span><span>Поддерживаются фразы и леммы по зонам</span></div>
          </article>
        </section>

        <div className={styles.actionRow}>
          <button className={styles.primaryButton} type="button" onClick={parseBrief}>Разобрать ТЗ <span>→</span></button>
          <p>Разбор ТЗ в браузере. ИИ вызывается отдельно: он получает текст статьи, правила и выбранную порцию рекомендаций.</p>
        </div>

        <section className={styles.aiPanel} aria-label="Настройка AI-редактора">
          <div className={styles.panelHead}>
            <div><span className={styles.step}>03 / ПОМОЩНИК ИИ</span><h2>Проверка рекомендаций и точечные правки</h2></div>
            <span className={styles.fileIcon}>AI</span>
          </div>
          {sourceInfo && <p className={styles.aiHint}>{sourceInfo}</p>}
          <div className={styles.aiSettings}>
            <label>Где будет публикация?
              <select value={scope} onChange={(event) => { setScope(event.target.value as EditorialScope); setEdits([]); setEditBatchStart(0); }}>
                <option value="publication">VC.ru / Состав — только статья</option>
                <option value="site">Собственный сайт — вся страница</option>
              </select>
            </label>
            <label>Пароль AI-редактора (Timeweb)
              <input type="password" value={editorPassword} onChange={(event) => setEditorPassword(event.target.value)} placeholder="EDITOR_ACCESS_TOKEN" autoComplete="off" />
            </label>
          </div>
          <label className={styles.rulesLabel}>Дополнительные требования к редактуре (необязательно)
            <textarea value={extraRules} onChange={(event) => setExtraRules(event.target.value)} maxLength={14000} rows={3} placeholder="Правила конкретного проекта, запреты на изменение офферов, обязательные формулировки…" />
          </label>
          <p className={styles.aiHint}>Базовые ограничения регламента 13.3 встроены в ИИ-инструкцию. Для VC исключены «Общее» и чужие анкоры; в собственном сайте доступны все зоны. Обрабатываем по 25 рекомендаций, чтобы контролировать стоимость.</p>
          <div className={styles.aiActions}>
            <button type="button" className={styles.primaryButton} disabled={Boolean(aiBusy) || !selectedForReview.length} onClick={() => void requestAi("review")}>{aiBusy === "review" ? "ИИ анализирует…" : `ИИ-разбор следующих ${Math.min(25, pendingReviewCount)}`} <span>→</span></button>
            <button type="button" className={styles.secondaryButton} disabled={Boolean(aiBusy) || !selectedForEdit.length} onClick={() => void requestAi("edit")}>{aiBusy === "edit" ? "ИИ готовит правки…" : `Предложить замены (${selectedForEdit.length} принято)`}</button>
            <button type="button" className={styles.secondaryButton} disabled={!article.trim()} onClick={exportArticle}>Скачать статью MD</button>
            {acceptedRows.length > 25 && <button type="button" className={styles.secondaryButton} disabled={Boolean(aiBusy)} onClick={() => { setEditBatchStart((current) => current + 25 >= acceptedRows.length ? 0 : current + 25); setEdits([]); }}>Другие принятые ({Math.min(editBatchStart + 1, acceptedRows.length)}–{Math.min(editBatchStart + 25, acceptedRows.length)} из {acceptedRows.length})</button>}
          </div>
          <p className={styles.aiHint}>Доступно рекомендаций в выбранном режиме: {availableCount}; ещё не обработано ИИ или вручную: {pendingReviewCount}. Пароль остаётся в памяти вкладки, не сохраняется в файлах. Запросы к OpenAI платные.</p>
          {needsBarCheck && <p className={styles.aiWarning}>Текст изменён: цифры в ТЗ БАР больше не соответствуют текущему тексту. Скачайте статью и запустите повторный анализ.</p>}
        </section>

        {edits.length > 0 && <section className={styles.editPanel} aria-label="Предложенные правки">
          <div className={styles.resultsHead}><div><span className={styles.step}>04 / ПРОСМОТР ИЗМЕНЕНИЙ</span><h2>Предложения ИИ</h2><p>Каждая замена проверяется по точному исходному фрагменту. Ничего не применяется автоматически.</p></div></div>
          {edits.map((edit, index) => <article className={styles.editCard} key={`${edit.find.slice(0, 40)}-${index}`}>
            <p><strong>Почему:</strong> {edit.reason}</p>
            <div className={styles.editCompare}><div><strong>Было</strong><pre>{edit.find}</pre></div><div><strong>Предлагается</strong><pre>{edit.replace}</pre></div></div>
            <div className={styles.exportActions}><button type="button" className={styles.primaryButton} onClick={() => applyEdit(index)}>Применить замену <span>✓</span></button><button type="button" className={styles.secondaryButton} onClick={() => setEdits((current) => current.filter((_, i) => i !== index))}>Отклонить</button></div>
          </article>)}
        </section>}

        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}

        {rows.length > 0 && (
          <section className={styles.results} aria-label="Разобранные рекомендации">
            <div className={styles.resultsHead}>
              <div><span className={styles.step}>05 / РЕДАКЦИОННАЯ СОРТИРОВКА</span><h2>{briefTitle || "Рекомендации БАР"}</h2><p>Ориентиры частотности не являются командами к механическому добавлению. Решение принимается с учётом смысла статьи и поискового интента.</p></div>
              <div className={styles.exportActions}>
                <button type="button" className={styles.secondaryButton} onClick={exportDecisions}>Скачать решения MD</button>
                <button type="button" className={styles.secondaryButton} onClick={exportAccepted} disabled={!stats.accepted}>Скачать принятые</button>
              </div>
            </div>

            <div className={styles.stats}>
              <div><strong>{stats.total}</strong><span>Всего</span></div>
              <div><strong>{stats.candidate}</strong><span>Кандидаты</span></div>
              <div className={styles.reviewStat}><strong>{stats.review}</strong><span>Проверить</span></div>
              <div className={styles.acceptStat}><strong>{stats.accepted}</strong><span>Принято</span></div>
              <div className={styles.rejectStat}><strong>{stats.rejected}</strong><span>Отклонено</span></div>
            </div>

            <div className={styles.toolbar}>
              <div className={styles.filters} role="group" aria-label="Фильтр решений">
                {FILTERS.map((item) => <button key={item.value} type="button" className={filter === item.value ? styles.filterActive : styles.filterButton} onClick={() => setFilter(item.value)}>{item.label}</button>)}
              </div>
              <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти фразу, лемму или зону" aria-label="Поиск рекомендаций" />
            </div>

            <div className={styles.recommendationList}>
              {visibleRows.map((row) => (
                <article className={styles.recommendation} key={row.id}>
                  <div className={styles.recMain}>
                    <div className={styles.recMeta}><span>{row.zoneLabel}</span><span>{row.kind === "phrase" ? "Фраза" : "Лемма"}</span><span>{row.action === "add" ? "Добавить" : "Снизить"}</span></div>
                    <h3>{row.term}</h3>
                    <div className={styles.metrics}>Сейчас <b>{row.current}</b><span>·</span> Ориентир <b>{row.target}</b><span>·</span> Диапазон <b>{row.min}–{row.max}</b></div>
                    {row.aiReason && <div className={styles.aiReason}><strong>Оценка ИИ:</strong> {row.aiReason}{row.aiSuggestion && <p><strong>Предложение:</strong> {row.aiSuggestion}</p>}</div>}
                    {row.reasons.length > 0 && <ul className={styles.reasons}>{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  </div>
                  <div className={styles.decisionControl}>
                    <label htmlFor={`decision-${row.id}`}>Решение</label>
                    <select id={`decision-${row.id}`} value={row.decision} onChange={(event) => updateDecision(row.id, event.target.value as RecommendationDecision)}>
                      {Object.entries(DECISION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </article>
              ))}
              {visibleRows.length === 0 && <div className={styles.empty}>По выбранному фильтру ничего не найдено.</div>}
            </div>
          </section>
        )}

        <aside className={styles.stageNote}>
          <div className={styles.stageIcon}>i</div>
          <div><strong>Как завершить работу</strong><p>Это этап 2: защищённая ИИ-классификация и точечные подтверждаемые замены. После правок скачайте Markdown, повторите анализ в БАР (вкладка «Вставить текст» либо URL собственного сайта после публикации) и публикуйте только после финального редакторского и фактического аудита. Автопубликации и автоматического запуска БАР пока нет.</p></div>
        </aside>
      </div>
    </main>
  );
}
