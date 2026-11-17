import { extractAgentSourceArticle } from "@/lib/semantic-analysis";

/** Fetch only the user's own VC.ru article; no competitor discovery or reanalysis. */
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 4_096) {
      return Response.json({ error: "Слишком большой запрос" }, { status: 413 });
    }
    const raw = await request.text();
    if (raw.length > 4_096) return Response.json({ error: "Слишком большой запрос" }, { status: 413 });
    const payload = JSON.parse(raw) as { url?: unknown; selector?: unknown };
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    const selector = typeof payload.selector === "string" ? payload.selector.trim() : "";
    if (!url || url.length > 2_048 || selector.length > 300) {
      return Response.json({ error: "Некорректный URL или CSS-селектор" }, { status: 400 });
    }
    const target = new URL(url);
    if (target.protocol !== "https:" || !["vc.ru", "www.vc.ru"].includes(target.hostname.toLowerCase())
      || target.username || target.password || target.port) {
      return Response.json({ error: "На этапе 4.0 поддерживается извлечение исходных статей только с HTTPS vc.ru" }, { status: 400 });
    }
    const result = await extractAgentSourceArticle(target.toString(), selector || undefined);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить статью VC.ru" }, { status: 400 });
  }
}
