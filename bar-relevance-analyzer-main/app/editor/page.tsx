"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildDecisionMarkdown,
  parseBriefMarkdown,
  type BriefRecommendation,
  type RecommendationDecision,
} from "@/lib/seo-editor/brief-parser";
import styles from "./editor.module.css";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const IMPORT_BRIEF_KEY = "bar:seo-editor:brief:v1";
const IMPORT_ARTICLE_KEY = "bar:seo-editor:article:v1";

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

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const importedBrief = sessionStorage.getItem(IMPORT_BRIEF_KEY);
        const importedArticle = sessionStorage.getItem(IMPORT_ARTICLE_KEY);
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
      setArticleName(name);
      setNotice(`Статья «${name}» загружена. Содержимое обрабатывается только в браузере.`);
    }, setError);
  };

  const handleBriefFile = (event: ChangeEvent<HTMLInputElement>) => {
    void readMarkdownFile(event, (value, name) => {
      setBrief(value);
      setBriefName(name);
      setRows([]);
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
    setBriefTitle(parsed.title);
    setFilter("all");
    setSearch("");
    setError("");
    setNotice(parsed.recommendations.length
      ? `Разобрано рекомендаций: ${parsed.recommendations.length}. Строк пропущено: ${parsed.ignoredLines}. Предварительные флаги требуют ручной проверки.`
      : "Не удалось найти рекомендации. Проверьте, что загружено ТЗ в формате Markdown из БАР.");
  };

  const updateDecision = (id: string, decision: RecommendationDecision) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, decision } : row));
  };

  const exportDecisions = () => {
    if (!rows.length) return;
    const markdown = buildDecisionMarkdown(briefTitle, rows);
    downloadText("bar-editor-decisions.md", markdown);
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
          <span className={styles.localBadge}>ЭТАП 1 · ИМПОРТ И РАЗБОР</span>
        </nav>
      </header>

      <div className={styles.shell}>
        <section className={styles.intro}>
          <span className={styles.eyebrow}>SEO WORKSPACE / EDITOR</span>
          <h1>От рекомендаций БАР<br />к осмысленным правкам</h1>
          <p>Загрузите статью и Markdown-ТЗ. Редактор разберёт рекомендации по зонам, покажет потенциально спорные формулировки и позволит принять решение по каждому пункту.</p>
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
            <textarea className={styles.textarea} value={article} onChange={(event) => setArticle(event.target.value)} placeholder="# Заголовок статьи\n\nВставьте сюда исходный текст в Markdown…" spellCheck={false} />
            <div className={styles.panelFoot}><span>{wordCount(article).toLocaleString("ru-RU")} слов</span><span>До 5 МБ · только в браузере</span></div>
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
          <p>Файлы не отправляются на сервер. На этом этапе разбор выполняется локально в браузере.</p>
        </div>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}

        {rows.length > 0 && (
          <section className={styles.results} aria-label="Разобранные рекомендации">
            <div className={styles.resultsHead}>
              <div><span className={styles.step}>03 / РЕДАКЦИОННАЯ СОРТИРОВКА</span><h2>{briefTitle || "Рекомендации БАР"}</h2><p>Ориентиры частотности не являются командами к механическому добавлению. Решение принимается с учётом смысла статьи и поискового интента.</p></div>
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
          <div><strong>Что уже работает и чего пока нет</strong><p>Это первая техническая версия: импорт Markdown, разбор зон и числовых ориентиров, предварительные флаги и ручное принятие решений. ИИ-классификация по смыслу, автоматическое редактирование и повторный запуск БАР будут подключены следующим этапом — после настройки серверной авторизации и API-ключа. Никакие формулы самого анализатора не меняются.</p></div>
        </aside>
      </div>
    </main>
  );
}
