import { previewPageExtraction } from "@/lib/semantic-analysis";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { url?: unknown; selector?: unknown };
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    const selector = typeof payload.selector === "string" ? payload.selector.trim() : "";
    if (!url) return Response.json({ error: "Укажите URL страницы" }, { status: 400 });
    if (url.length > 2_048) return Response.json({ error: "URL слишком длинный (максимум 2048 символов)" }, { status: 400 });
    if (selector.length > 300) return Response.json({ error: "CSS-селектор слишком длинный (максимум 300 символов)" }, { status: 400 });
    return Response.json(await previewPageExtraction(url, selector || undefined));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось извлечь содержимое страницы" }, { status: 400 });
  }
}
