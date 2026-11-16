export type ExtractionZone = { available: boolean; blocks: string[] };
export type ExtractionZones = Record<"all" | "title" | "h1" | "headings" | "text" | "anchors", ExtractionZone>;

export type HtmlContentExtraction = {
  title: string;
  titleSource: "content-title" | "document-title" | "none";
  text: string;
  headings: number;
  htmlLanguage: string;
  zones: ExtractionZones;
  selector: string;
  profile: "vc" | "custom" | "automatic";
  selectedElements: number;
  textBlocks: number;
  linkCount: number;
};

type HtmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlNode | string>;
  parent: HtmlNode | null;
};

type SelectorPart = { simple: string; combinator: " " | ">" | null };

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "canvas", "nav", "footer", "aside", "form", "button", "select", "option", "dialog"]);
const BLOCK_TAGS = new Set(["address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);
const MAX_HTML_NESTING = 256;
const MAX_SELECTOR_GROUPS = 20;
const MAX_SELECTOR_PARTS = 12;

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
    laquo: "«", raquo: "»", hellip: "…", copy: "©", reg: "®", trade: "™", bull: "•",
  };
  return value.replace(/&#(\d+);/g, (_, code) => {
    const number = Number(code);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : ""; } catch { return ""; }
  }).replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    try { return String.fromCodePoint(parseInt(code, 16)); } catch { return ""; }
  }).replace(/&([a-z][a-z0-9]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function findTagEnd(html: string, start: number) {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return -1;
}

function parseAttributes(source: string) {
  const attrs: Record<string, string> = {};
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(expression)) {
    const name = match[1].toLowerCase();
    if (!name || name.startsWith("on") || name === "style") continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "#document", attrs: {}, children: [], parent: null };
  const stack: HtmlNode[] = [root];
  let cursor = 0;
  while (cursor < html.length) {
    const current = stack[stack.length - 1];
    if (html.startsWith("<!--", cursor)) {
      const end = html.indexOf("-->", cursor + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[cursor] !== "<") {
      const end = html.indexOf("<", cursor);
      const stop = end < 0 ? html.length : end;
      if (stop > cursor) current.children.push(decodeEntities(html.slice(cursor, stop)));
      cursor = stop;
      continue;
    }
    if (/^<!|^<\?/u.test(html.slice(cursor, cursor + 2))) {
      const end = findTagEnd(html, cursor + 2);
      cursor = end < 0 ? html.length : end + 1;
      continue;
    }
    const end = findTagEnd(html, cursor + 1);
    if (end < 0) {
      current.children.push("<");
      cursor += 1;
      continue;
    }
    const rawTag = html.slice(cursor + 1, end);
    const closing = rawTag.match(/^\s*\/\s*([a-z][a-z0-9:-]*)/i);
    if (closing) {
      const tag = closing[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      cursor = end + 1;
      continue;
    }
    const opening = rawTag.match(/^\s*([a-z][a-z0-9:-]*)/i);
    if (!opening) {
      current.children.push("<");
      cursor += 1;
      continue;
    }
    const tag = opening[1].toLowerCase();
    const attrSource = rawTag.slice(opening[0].length).replace(/\/\s*$/u, "");
    const attrs = parseAttributes(attrSource);

    // Apply the most common HTML optional-end-tag rules so malformed fragments
    // still produce a useful tree for article extraction.
    const implicitlyClosed = new Set(["li", "p", "dt", "dd", "option", "tr", "td", "th"]);
    if (implicitlyClosed.has(tag)) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag || (tag === "td" && stack[index].tag === "th") || (tag === "th" && stack[index].tag === "td")) {
          stack.length = index;
          break;
        }
        if (["ul", "ol", "table", "select", "body", "html"].includes(stack[index].tag)) break;
      }
    }
    if (/^h[1-6]$/u.test(tag) || ["address", "article", "blockquote", "div", "dl", "fieldset", "figure", "footer", "form", "header", "main", "nav", "ol", "pre", "section", "table", "ul"].includes(tag)) {
      if (stack[stack.length - 1].tag === "p") stack.pop();
    }

    const parent = stack[stack.length - 1];
    const node: HtmlNode = { tag, attrs, children: [], parent };
    parent.children.push(node);
    cursor = end + 1;
    if (VOID_TAGS.has(tag) || /\/\s*$/u.test(rawTag)) continue;
    if (RAW_TEXT_TAGS.has(tag)) {
      const closeExpression = new RegExp(`<\\/\\s*${tag}\\s*>`, "ig");
      closeExpression.lastIndex = cursor;
      const close = closeExpression.exec(html);
      cursor = close ? closeExpression.lastIndex : html.length;
      continue;
    }
    if (stack.length >= MAX_HTML_NESTING) throw new Error(`HTML содержит слишком глубокую вложенность (лимит ${MAX_HTML_NESTING})`);
    stack.push(node);
  }
  return root;
}

function splitSelectorGroups(selector: string) {
  const groups: string[] = [];
  let start = 0;
  let bracketDepth = 0;
  let quote = "";
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) { if (char === quote && selector[index - 1] !== "\\") quote = ""; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === "," && bracketDepth === 0) {
      groups.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  groups.push(selector.slice(start).trim());
  return groups.filter(Boolean);
}

function parseSelectorGroup(selector: string): SelectorPart[] {
  const parts: SelectorPart[] = [];
  let token = "";
  let bracketDepth = 0;
  let quote = "";
  let pending: " " | ">" | null = null;
  const flush = () => {
    const value = token.trim();
    if (!value) return;
    parts.push({ simple: value, combinator: parts.length ? pending ?? " " : null });
    token = "";
    pending = null;
  };
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) { token += char; if (char === quote && selector[index - 1] !== "\\") quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; token += char; continue; }
    if (char === "[") { bracketDepth += 1; token += char; continue; }
    if (char === "]") { bracketDepth -= 1; token += char; continue; }
    if (bracketDepth === 0 && char === ">") {
      flush();
      pending = ">";
      continue;
    }
    if (bracketDepth === 0 && /\s/u.test(char)) {
      flush();
      if (pending !== ">" && parts.length) pending = " ";
      continue;
    }
    token += char;
  }
  flush();
  if (!parts.length || parts.some((part) => !part.simple)) throw new Error("Некорректный CSS-селектор");
  if (parts.length > MAX_SELECTOR_PARTS) throw new Error(`CSS-селектор содержит слишком много уровней (максимум ${MAX_SELECTOR_PARTS})`);
  return parts;
}

function matchesSimple(node: HtmlNode, selector: string) {
  if (node.tag.startsWith("#")) return false;
  let rest = selector;
  const tagMatch = rest.match(/^([a-z][a-z0-9:-]*|\*)/i);
  if (tagMatch) {
    if (tagMatch[1] !== "*" && node.tag !== tagMatch[1].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest) {
    if (rest.startsWith(".")) {
      const match = rest.match(/^\.([\w-]+)/u);
      if (!match) return false;
      const classes = (node.attrs.class ?? "").split(/\s+/u);
      if (!classes.includes(match[1])) return false;
      rest = rest.slice(match[0].length);
      continue;
    }
    if (rest.startsWith("#")) {
      const match = rest.match(/^#([\w-]+)/u);
      if (!match || node.attrs.id !== match[1]) return false;
      rest = rest.slice(match[0].length);
      continue;
    }
    if (rest.startsWith("[")) {
      const match = rest.match(/^\[\s*([\w:-]+)\s*(?:(\^=|\$=|\*=|~=|\|=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/u);
      if (!match) return false;
      const actual = node.attrs[match[1].toLowerCase()];
      if (actual === undefined) return false;
      const expected = match[3] ?? match[4] ?? match[5] ?? "";
      const operator = match[2];
      if (operator === "=" && actual !== expected) return false;
      if (operator === "^=" && !actual.startsWith(expected)) return false;
      if (operator === "$=" && !actual.endsWith(expected)) return false;
      if (operator === "*=" && !actual.includes(expected)) return false;
      if (operator === "~=" && !actual.split(/\s+/u).includes(expected)) return false;
      if (operator === "|=" && actual !== expected && !actual.startsWith(`${expected}-`)) return false;
      rest = rest.slice(match[0].length);
      continue;
    }
    // Pseudo-classes and unsupported CSS syntax fail closed rather than
    // silently selecting an unexpectedly broad part of the page.
    return false;
  }
  return true;
}

function matchesSelector(node: HtmlNode, parts: SelectorPart[], index = parts.length - 1): boolean {
  if (!matchesSimple(node, parts[index].simple)) return false;
  if (index === 0) return true;
  const combinator = parts[index].combinator ?? " ";
  if (combinator === ">") return node.parent ? matchesSelector(node.parent, parts, index - 1) : false;
  let ancestor = node.parent;
  while (ancestor) {
    if (matchesSelector(ancestor, parts, index - 1)) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function walk(node: HtmlNode, visit: (node: HtmlNode) => void) {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    visit(child);
    walk(child, visit);
  }
}

function querySelectorAll(root: HtmlNode, selector: string): HtmlNode[] {
  if (selector.length > 300) throw new Error("CSS-селектор слишком длинный (максимум 300 символов)");
  const groups = splitSelectorGroups(selector);
  if (groups.length > MAX_SELECTOR_GROUPS) throw new Error(`CSS-селектор содержит слишком много групп (максимум ${MAX_SELECTOR_GROUPS})`);
  const parsed = groups.map(parseSelectorGroup);
  const result = new Set<HtmlNode>();
  walk(root, (node) => {
    if (parsed.some((parts) => matchesSelector(node, parts))) result.add(node);
  });
  return [...result];
}

function textContent(node: HtmlNode, skip: (node: HtmlNode) => boolean = () => false): string {
  if (skip(node) || SKIP_TAGS.has(node.tag)) return "";
  if (node.tag === "br" || node.tag === "hr") return "\n";
  const content = node.children.map((child) => typeof child === "string" ? child : textContent(child, skip)).join("");
  return BLOCK_TAGS.has(node.tag) ? `\n${content}\n` : content;
}

function cleanBlocks(value: string) {
  return value.split(/\n+/u).map((line) => line.replace(/[\t \u00a0]+/gu, " ").trim()).filter((line) => line.length >= 2);
}

function innerText(node: HtmlNode) {
  return textContent(node).replace(/\s+/gu, " ").trim();
}

function descendants(root: HtmlNode, predicate: (node: HtmlNode) => boolean) {
  const result: HtmlNode[] = [];
  walk(root, (node) => { if (predicate(node)) result.push(node); });
  return result;
}

function documentTitle(root: HtmlNode) {
  const title = descendants(root, (node) => node.tag === "title")[0];
  return title ? innerText(title) : "";
}

function isDescendantOrSelf(node: HtmlNode, ancestor: HtmlNode) {
  let current: HtmlNode | null = node;
  while (current) { if (current === ancestor) return true; current = current.parent; }
  return false;
}

function isVcHost(rawUrl?: string) {
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./u, "");
    return host === "vc.ru" || host.endsWith(".vc.ru");
  } catch { return false; }
}

function roughTextLength(node: HtmlNode) {
  return innerText(node).length;
}

export function extractHtmlContent(html: string, options: { url?: string; selector?: string } = {}): HtmlContentExtraction {
  const root = parseHtml(html);
  const vc = isVcHost(options.url);
  const requestedSelector = options.selector?.trim() ?? "";
  const selector = requestedSelector || (vc ? ".content__body" : "");
  const profile: HtmlContentExtraction["profile"] = requestedSelector ? "custom" : vc ? "vc" : "automatic";
  let selected: HtmlNode;
  const selectedElements = 1;
  let automaticHeader: HtmlNode | null = null;
  if (selector) {
    const matches = querySelectorAll(root, selector);
    if (!matches.length) throw new Error(`Не найден контейнер по CSS-селектору «${selector}». Страница не будет анализироваться целиком.`);
    if (matches.length > 1 && profile !== "vc") throw new Error(`CSS-селектор «${selector}» нашёл ${matches.length} элементов. Уточните селектор, чтобы выбрать один контейнер.`);
    if (profile === "vc" && matches.length > 1) {
      const mainArticles = matches.filter((candidate) => {
        const hasH1 = descendants(candidate, (node) =>
          node.tag === "h1" && (node.attrs.class ?? "").split(/\s+/u).includes("content-title"),
        ).length > 0;
        const hasBody = descendants(candidate, (node) =>
          node.tag === "article" && (node.attrs.class ?? "").split(/\s+/u).includes("content__blocks"),
        ).length > 0;
        return hasH1 && hasBody;
      });
      if (mainArticles.length !== 1) throw new Error(`VC.ru: найдено ${matches.length} контейнеров «${selector}», но не удалось однозначно определить основной материал.`);
      selected = mainArticles[0];
    } else {
      selected = matches[0];
    }
  } else {
    const body = descendants(root, (node) => node.tag === "body")[0] ?? root;
    const main = descendants(body, (node) => node.tag === "main")[0];
    const article = descendants(body, (node) => node.tag === "article")[0];
    const candidates = [main, article, body].filter((node): node is HtmlNode => Boolean(node));
    selected = candidates.find((candidate) => roughTextLength(candidate) >= 800) ?? candidates[candidates.length - 1] ?? body;
    if (selected !== body) automaticHeader = descendants(body, (node) => node.tag === "header")[0] ?? null;
  }
  const contentRoots = automaticHeader && !selector ? [automaticHeader, selected] : [selected];

  const contentTitle = descendants(selected, (node) => (node.attrs.class ?? "").split(/\s+/u).includes("content-title"))[0];
  const useArticleTitle = Boolean(contentTitle && (vc || isDescendantOrSelf(contentTitle, selected)));
  const title = useArticleTitle ? innerText(contentTitle!) : documentTitle(root);
  const titleSource: HtmlContentExtraction["titleSource"] = useArticleTitle ? "content-title" : title ? "document-title" : "none";
  const titleNode = useArticleTitle ? contentTitle : null;

  const selectedH1 = contentRoots.flatMap((contentRoot) => descendants(contentRoot, (node) => node.tag === "h1"));
  const h1Blocks = useArticleTitle ? (title ? [title] : []) : selectedH1.map(innerText).filter(Boolean);
  const headingNodes = contentRoots.flatMap((contentRoot) => descendants(contentRoot, (node) => /^h[2-6]$/u.test(node.tag)));
  const headingBlocks = headingNodes.map(innerText).filter(Boolean);
  const anchorNodes = contentRoots.flatMap((contentRoot) => descendants(contentRoot, (node) => node.tag === "a"));
  const anchorBlocks = anchorNodes.map(innerText).filter(Boolean);

  const skipTitle = (node: HtmlNode) => Boolean(titleNode && node === titleNode);
  const bodyBlocks = contentRoots.flatMap((contentRoot) => cleanBlocks(textContent(contentRoot, skipTitle)));
  const textBlocks = contentRoots.flatMap((contentRoot) => cleanBlocks(textContent(contentRoot, (node) => skipTitle(node) || /^h[1-6]$/u.test(node.tag) || node.tag === "a")));
  const titleBlocks = title ? [title] : [];
  const zones: ExtractionZones = {
    all: { available: true, blocks: [...titleBlocks, ...bodyBlocks] },
    title: { available: true, blocks: titleBlocks },
    h1: { available: true, blocks: h1Blocks },
    headings: { available: true, blocks: headingBlocks },
    text: { available: true, blocks: textBlocks },
    anchors: { available: true, blocks: anchorBlocks },
  };
  const languageNode = descendants(root, (node) => node.tag === "html")[0];
  const htmlLanguage = (languageNode?.attrs.lang ?? "").toLowerCase().split(/[-_]/u)[0];
  const headings = h1Blocks.length + headingBlocks.length;
  const text = bodyBlocks.join("\n");
  return {
    title, titleSource, text, headings, htmlLanguage, zones, selector: selector || "Автоматический выбор основной области",
    profile, selectedElements, textBlocks: textBlocks.length, linkCount: anchorBlocks.length,
  };
}
