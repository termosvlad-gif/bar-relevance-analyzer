"use client";
import { loadAgentHandoff, saveAgentHandoff } from "@/lib/agent/browser-store";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseBriefMarkdown } from "@/lib/seo-editor/brief-parser";
import {
  AGENT_TRANSFER_KEY, parseAgentHandoff, type AgentHandoff,
} from "@/lib/agent/bar-import";
import styles from "./agent.module.css";

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

type ExtractedArticle = { url: string; title: string; text: string; headings: string[]; source: string; truncated: boolean; error?: string };

function downloadJson(handoff: AgentHandoff) {
  const blob = new Blob([JSON.stringify(handoff, null, 2)], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "bar_agent_stage4_import.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

export default function AgentPage() {
  const [job, setJob] = useState<AgentHandoff | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadingArticle, setLoadingArticle] = useState(false);

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        let imported: AgentHandoff | null = null;

        try {
          imported = await loadAgentHandoff();
        } catch {
          // Try the legacy session transfer below.
        }

        if (!imported) {
          const saved = sessionStorage.getItem(AGENT_TRANSFER_KEY);
          if (saved) {
            imported = parseAgentHandoff(JSON.parse(saved) as unknown);
            try { await saveAgentHandoff(imported); } catch {}
          }
        }

        if (active && imported) {
          setJob(imported);
          setNotice("Полный отчёт БАР и SEO-ТЗ получены.");
        }
      } catch {
        if (active) setError("Не удалось восстановить отчёт. Импортируйте JSON.");
      }
    }

    void restore();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!job || job.source.mode !== "url" || job.source.text.trim()) return;
    if (!/^https:\/\/(?:www\.)?vc\.ru\//i.test(job.source.url)) return;

    let active = true;
    const controller = new AbortController();

    async function fetchArticle() {
      if (!job) return;
      setLoadingArticle(true);

      try {
        const response = await fetch("/api/agent/article", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: job.source.url,
            selector: job.source.selector,
          }),
          signal: controller.signal,
        });

        const data = await response.json() as {
          text?: string;
          error?: string;
          truncated?: boolean;
        };

        if (!response.ok || typeof data.text !== "string" || !data.text.trim()) {
          throw new Error(data.error || "Не удалось извлечь текст");
        }

        if (!active) return;

        const articleText = data.text.slice(0, 200_000);
        const updated: AgentHandoff = {
          ...job,
          source: { ...job.source, text: articleText },
        };

        setJob(updated);
        setNotice(
          data.truncated || data.text.length > articleText.length
            ? "Текст статьи загружен автоматически, но был сокращён."
            : "Полный текст статьи загружен автоматически."
        );

        await saveAgentHandoff(updated);
      } catch {
        if (active) {
          setNotice(
            "Отчёт получен. Статью не удалось загрузить автоматически. Доступна ручная загрузка."
          );
        }
      } finally {
        if (active) setLoadingArticle(false);
      }
    }

    void fetchArticle();
    return () => {
      active = false;
      controller.abort();
    };
  }, [job]);

  const parsed = useMemo(() => job ? parseBriefMarkdown(job.bar.markdownBrief) : null, [job]);
  const report = job?.bar.rawAnalysis;
  const ownDocument = report?.documents.find((row) => row && typeof row === "object" && "ours" in row && row.ours === true) as
    | { title?: string; url?: string; words?: number } | undefined;
  const snapshot = report?.snapshot as { own?: { url?: string; title?: string } } | undefined;
  const articleUrl = job?.source.url || snapshot?.own?.url || ownDocument?.url || "";
  const articleTitle = ownDocument?.title || snapshot?.own?.title || "—";
  const competitorCount = (report?.snapshot as { competitors?: unknown[] } | undefined)?.competitors?.length ?? 0;
  const hasArticle = Boolean(job?.source.text.trim());

  function setImported(next: AgentHandoff, message: string) {
    setJob(next);
    setError("");
    setNotice(message);
    void saveAgentHandoff(next).catch(() => {
      setNotice(`${message} Сохранение в браузере не удалось. Скачайте JSON для резервной копии.`);
    });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("JSON-файл больше 25 МБ. Проверьте размер полного отчёта БАР.");
      return;
    }
    try {
      const parsedFile = parseAgentHandoff(JSON.parse(await file.text()) as unknown);
      setImported(parsedFile, `Импортирован файл «${file.name}».`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось импортировать отчёт БАР");
    }
  }

  async function loadArticle() {
    if (!job || !articleUrl || loadingArticle) return;
    setLoadingArticle(true);
    setError("");
    try {
      const response = await fetch("/api/agent/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: articleUrl, selector: job.source.selector }),
      });
      const data = await response.json() as ExtractedArticle;
      if (!response.ok || !data.text) throw new Error(data.error || "Сервер не вернул текст статьи");
      const updated: AgentHandoff = {
        ...job, source: { ...job.source, mode: "url", url: data.url, text: data.text },
      };
      setImported(updated, `Получена исходная статья (${data.text.length.toLocaleString("ru-RU")} символов, ${data.source}${data.truncated ? "; текст усечён" : ""}). Исходные расчёты БАР не изменены.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось получить текст VC.ru");
    } finally {
      setLoadingArticle(false);
    }
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <strong>БАР <span className={styles.overline}>/ Контент-фабрика</span></strong>
        <div className={styles.row}><Link href="/analyzer">← Анализатор</Link><Link href="/editor">Прежний AI SEO Editor</Link></div>
      </header>
      <span className={styles.overline}>Stage 4.0 · передача данных</span>
      <h1 className={styles.title}>ИИ-агент контент-фабрики</h1>
      <p className={styles.intro}>Первый этап нового модуля: переносим полный неизменённый результат БАР и исходное SEO-ТЗ. ИИ-экспертиза, галочки, создание статьи и аудит будут подключены отдельно после проверки импорта.</p>
      <div className={styles.steps}>
        <span className={styles.current}>1. Импорт БАР</span><span>2. Проверка ИИ</span><span>3. Ваши галочки</span><span>4. Написание</span><span>5. Аудит и MD</span>
      </div>
      <section className={styles.card}>
        <h2>Передать результат анализа</h2>
        <p>Откройте готовый отчёт в БАР и нажмите «Передать агенту». Если отчёт слишком большой для передачи между страницами, импортируйте экспортированный JSON.</p>
        <div className={styles.row}>
          <Link className={`${styles.button} ${styles.secondary}`} href="/analyzer">Открыть БАР</Link>
          <label className={`${styles.fileButton} ${styles.secondary}`}>Загрузить JSON из БАР<input aria-label="Импортировать отчёт БАР из JSON" type="file" accept=".json,application/json" onChange={(event) => void importFile(event)}/></label>
          {job && <button className={styles.button} type="button" onClick={() => downloadJson(job)}>Скачать полный JSON</button>}
        </div>
        {notice && <p role="status" className={styles.success}>{notice}</p>}
        {error && <div role="alert" className={styles.error}>{error}</div>}
      </section>

      {job && report && <div className={styles.grid} style={{ marginTop: 18 }}>
        <section className={styles.card}>
          <h2>01 · Данные БАР</h2>
          <dl className={styles.meta}>
            <dt>Поисковая тема</dt><dd>{report.meta.serpQuery}</dd>
            <dt>Ключевые запросы</dt><dd>{report.meta.queries?.join(", ") || "—"}</dd>
            <dt>Статья</dt><dd>{articleTitle}</dd>
            <dt>Адрес статьи</dt><dd>{articleUrl || "Не передан — вставьте текст вручную на следующем этапе"}</dd>
            <dt>Снимок БАР</dt><dd>{report.meta.snapshotId}</dd>
            <dt>Конкуренты в снимке</dt><dd>{competitorCount}</dd>
            <dt>Леммы / N-граммы</dt><dd>{report.terms.length} / {report.ngrams.length}</dd>
            <dt>Дата расчёта</dt><dd>{report.meta.analyzedAt}</dd>
          </dl>
          <p className={styles.small}>Сохраняем весь исходный ответ БАР: показатели, HTML-зоны, документы, предупреждения, конкурентные профили и snapshot v5. Повторного поиска конкурентов нет.</p>
        </section>

        <section className={styles.card}>
          <h2>02 · Исходная статья</h2>
          {hasArticle ? <>
            <p className={styles.success}>Полный текст статьи загружен ({job.source.text.length.toLocaleString("ru-RU")} символов).</p>
            <details><summary>Показать полученный текст</summary><pre className={styles.preview}>{job.source.text}</pre></details>
          </> : <>
            <p>В snapshot БАР хранятся рассчитанные частоты, <strong>но не полный исходный текст</strong>. Для работы редактора его необходимо получить отдельно.</p>
            {articleUrl ? <div className={styles.row}>
              <button className={styles.button} type="button" disabled={loadingArticle} onClick={() => void loadArticle()}>{loadingArticle ? "Получаем статью…" : "Загрузить текст VC.ru"}</button>
            </div> : <p className={styles.note}>Для анализа вставленного текста исходный материал необходимо повторно приложить: БАР не сохраняет его в snapshot.</p>}
            <p className={styles.small}>Загрузка относится только к исходной статье, не к конкурентам. Используются существующие проверки URL и Firecrawl при необходимости. Если статья изменилась с момента анализа БАР, извлечённый сейчас текст может отличаться от исходного корпуса.</p>
          </>}
        </section>

        <section className={`${styles.card} ${styles.wide}`}>
          <h2>03 · Исходное SEO-ТЗ БАР</h2>
          <p>{parsed?.recommendations.length ?? 0} рекомендаций найдено в оригинальном Markdown. Пока они не классифицируются ИИ и не применяются автоматически.</p>
          <details><summary>Показать ТЗ полностью</summary><pre className={styles.preview}>{job.bar.markdownBrief}</pre></details>
          {!!parsed?.ignoredLines && <p className={styles.small}>Не удалось разобрать строк заданий: {parsed.ignoredLines}. Оригинальное ТЗ сохранено без потерь.</p>}
          <p className={styles.note}>Следующий этап Stage 4.1: ИИ проверит рекомендации, обоснует сомнительные пункты и покажет галочки. Без вашего подтверждения написание статьи не начнётся.</p>
        </section>
      </div>}
    </div>
  </main>;
}
