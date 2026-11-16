import assert from "node:assert/strict";
import test from "node:test";
import { extractHtmlContent } from "../lib/html-content-extractor.ts";

const vcHtml = `<!doctype html>
<html lang="ru"><head><title>Метатег платформы — VC.ru</title></head><body>
<nav>Навигация платформы и посторонний текст</nav>
<div class="page-shell">
  <div class="content__body">
    <h1 class="content-title"><span>Аренда авто в Турции для россиян: рейтинг сервисов</span></h1>
    <article class="content__blocks">
      <figure class="block-wrapper block-wrapper--header"><h2 class="block-header">Как выбрать сервис аренды авто</h2></figure>
      <figure class="block-wrapper block-wrapper--default"><div class="block-text"><p>Аренда автомобиля в Турции помогает самостоятельно путешествовать по побережью и выбирать удобный маршрут.</p></div></figure>
      <figure class="block-wrapper block-wrapper--default"><div class="block-text"><p>Перед бронированием проверьте условия страховки, размер депозита и ограничения пробега.</p></div></figure>
      <figure class="block-wrapper block-wrapper--default"><div class="block-text"><p><a href="https://example.test/rent">Сравнить предложения прокатчиков</a> и условия оплаты.</p></div></figure>
      <figure class="block-wrapper block-wrapper--header"><h3 class="block-header">Документы и требования</h3></figure>
      <figure class="block-wrapper block-wrapper--default"><ol class="block-list"><li>Проверьте водительское удостоверение.</li><li>Уточните возраст и стаж.</li></ol></figure>
    </article>
  </div>
</div>
<aside>Рекомендованные публикации и боковая колонка</aside>
<footer>Футер VC.ru</footer>
</body></html>`;

test("VC.ru profile extracts only .content__body and uses .content-title as Title and H1", () => {
  const result = extractHtmlContent(vcHtml, { url: "https://vc.ru/travel/123456-article" });
  assert.equal(result.profile, "vc");
  assert.equal(result.selector, ".content__body");
  assert.equal(result.title, "Аренда авто в Турции для россиян: рейтинг сервисов");
  assert.equal(result.titleSource, "content-title");
  assert.deepEqual(result.zones.title.blocks, [result.title]);
  assert.deepEqual(result.zones.h1.blocks, [result.title]);
  assert.equal(result.zones.all.blocks.filter((block) => block === result.title).length, 1);
  assert.deepEqual(result.zones.headings.blocks, ["Как выбрать сервис аренды авто", "Документы и требования"]);
  assert.deepEqual(result.zones.anchors.blocks, ["Сравнить предложения прокатчиков"]);
  assert.doesNotMatch(result.zones.text.blocks.join(" "), /Как выбрать сервис аренды авто|Сравнить предложения прокатчиков/u);
  assert.doesNotMatch(result.text, /Навигация платформы|Рекомендованные публикации|Футер VC\.ru/);
  assert.match(result.text, /Аренда автомобиля в Турции/);
  assert.equal(result.headings, 3);
});

test("a custom CSS selector restricts extraction to one selected container", () => {
  const html = `<html lang="ru"><head><title>Сайт: аренда авто</title></head><body>
    <header>Служебная шапка</header><main><section class="article-content"><h1>Заголовок материала</h1><p>Первый абзац выбранной статьи о прокате автомобиля.</p><p>Второй абзац содержит условия аренды и страховки.</p></section><section class="recommendations">Похожие материалы и рекомендации</section></main>
  </body></html>`;
  const result = extractHtmlContent(html, { url: "https://example.test/page", selector: "main > section.article-content" });
  assert.equal(result.profile, "custom");
  assert.equal(result.selector, "main > section.article-content");
  assert.equal(result.title, "Сайт: аренда авто");
  assert.deepEqual(result.zones.h1.blocks, ["Заголовок материала"]);
  assert.doesNotMatch(result.text, /Служебная шапка|Похожие материалы/);
  assert.match(result.text, /Первый абзац выбранной статьи/);
});

test("a missing explicit selector fails closed instead of analyzing the whole page", () => {
  assert.throws(
    () => extractHtmlContent("<html><body><main><p>Достаточно длинный текст страницы для тестирования.</p></main></body></html>", { url: "https://example.test", selector: ".missing-article" }),
    /не будет анализироваться целиком/u,
  );
});

test("automatic extraction preserves document title and the main page heading separately", () => {
  const html = `<html lang="ru"><head><title>Мета Title сайта</title></head><body><header>Шапка сайта</header><main><h1>Заголовок страницы</h1><h2>Раздел страницы</h2><p>Основной содержательный текст страницы с полезной информацией.</p></main><footer>Футер</footer></body></html>`;
  const result = extractHtmlContent(html, { url: "https://example.test/page" });
  assert.equal(result.profile, "automatic");
  assert.equal(result.title, "Мета Title сайта");
  assert.deepEqual(result.zones.h1.blocks, ["Заголовок страницы"]);
  assert.deepEqual(result.zones.headings.blocks, ["Раздел страницы"]);
  assert.doesNotMatch(result.text, /Футер/);
});


test("an explicit selector matching multiple containers is rejected", () => {
  const html = `<html><body><main><section class="article">Первый контейнер с содержимым статьи.</section><section class="article">Второй контейнер с содержимым статьи.</section></main></body></html>`;
  assert.throws(
    () => extractHtmlContent(html, { url: "https://example.test", selector: ".article" }),
    /нашёл 2 элементов/u,
  );
});
