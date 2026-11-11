/**
 * Netlify Function: 기사 링크로 스크랩 항목 자동 채우기
 * POST /.netlify/functions/autofill  { url?, text? }
 * GEMINI_API_KEY required. Optional GEMINI_MODEL (default: gemini-3.8-flash).
 */

export const PRESET_TAGS = [
  "금리", "환율", "유가", "주식시장", "반도체", "부동산", "미국", "물가", "기업실적", "정책"
];

export const WHO_OPTIONS = ["대출자/차주", "예금자/투자자", "기업/산업", "기타"];

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const MAX_ARTICLE_CHARS = 8000;
export const FETCH_TIMEOUT_MS = 12000;
export const GEMINI_TIMEOUT_MS = 20000;

export const PRESS_MAP = {
  "yna.co.kr": "연합뉴스",
  "yonhapnews.co.kr": "연합뉴스",
  "kbs.co.kr": "KBS",
  "imnews.imbc.com": "MBC",
  "imbc.com": "MBC",
  "sbs.co.kr": "SBS",
  "chosun.com": "조선일보",
  "biz.chosun.com": "조선비즈",
  "joongang.co.kr": "중앙일보",
  "joins.com": "중앙일보",
  "donga.com": "동아일보",
  "hani.co.kr": "한겨레",
  "khan.co.kr": "경향신문",
  "mk.co.kr": "매일경제",
  "hankyung.com": "한국경제",
  "sedaily.com": "서울경제",
  "edaily.co.kr": "이데일리",
  "news1.kr": "뉴스1",
  "newsis.com": "뉴시스",
  "mt.co.kr": "머니투데이",
  "fnnews.com": "파이낸셜뉴스",
  "etnews.com": "전자신문",
  "zdnet.co.kr": "지디넷코리아",
  "ytn.co.kr": "YTN",
  "jtbc.co.kr": "JTBC",
  "nocutnews.co.kr": "노컷뉴스",
  "ohmynews.com": "오마이뉴스",
  "pressian.com": "프레시안",
  "hankookilbo.com": "한국일보",
  "seoul.co.kr": "서울신문",
  "kmib.co.kr": "국민일보",
  "munhwa.com": "문화일보",
  "mbn.co.kr": "MBN",
  "tvchosun.com": "TV조선",
  "sisain.co.kr": "시사IN",
  "businesspost.co.kr": "비즈니스포스트",
  "thebell.co.kr": "더벨",
  "bloter.net": "블로터",
  "koreaherald.com": "코리아헤럴드",
  "koreatimes.co.kr": "코리아타임스",
  "wowtv.co.kr": "한국경제TV",
  "news.naver.com": "네이버뉴스",
  "n.news.naver.com": "네이버뉴스",
  "v.daum.net": "다음뉴스",
  "news.daum.net": "다음뉴스"
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BODY_SELECTORS = [
  '[itemprop="articleBody"]',
  "#article-view-content-div",
  "#articleBodyContents",
  "#articleBody",
  "#articeBody",
  "#newsEndContents",
  "#dic_area",
  "#article-view",
  "#articleWrap",
  ".news_cnt_detail_wrap",
  ".sec_body",
  ".view_art",
  ".story-news",
  ".article-body",
  ".article_body",
  ".article-view",
  ".article_view",
  ".article-txt",
  ".article_txt",
  ".news-body",
  ".news_body",
  ".view_cont",
  ".article-content",
  ".article_content",
  "article"
];

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

export function isAllowedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return false;
  if (host === "0.0.0.0" || host === "::1" || host === "::" || host === "[::1]") return false;
  if (host === "metadata.google.internal") return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  if (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) {
    return false;
  }
  return true;
}

export function normalizeCharset(raw) {
  const c = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "");
  if (["euc-kr", "euc_kr", "ks_c_5601-1987", "ks_c_5601", "windows-949", "cp949"].includes(c)) {
    return "euc-kr";
  }
  if (c === "utf8" || c === "utf-8") return "utf-8";
  return c || "utf-8";
}

export function sniffCharset(buf, contentType) {
  const ct = String(contentType || "");
  const fromHeader = ct.match(/charset\s*=\s*["']?([^\s"';]+)/i);
  if (fromHeader) return normalizeCharset(fromHeader[1]);
  const head = Buffer.from(buf).subarray(0, 8192).toString("latin1");
  const fromMeta =
    head.match(/<meta[^>]*charset\s*=\s*["']?([^\s"';>/]+)/i) ||
    head.match(/<meta[^>]+content=["'][^"']*charset=([^\s"';]+)/i);
  if (fromMeta) return normalizeCharset(fromMeta[1]);
  return "utf-8";
}

export function decodeHtmlBuffer(buf, contentType) {
  const charset = sniffCharset(buf, contentType);
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return Buffer.from(buf).toString("utf8");
  }
}

export function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function metaContent(html, names) {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${esc}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${esc}["']`,
        "i"
      )
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1].trim()) return decodeEntities(m[1].trim());
    }
  }
  return "";
}

function tagText(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? cleanText(m[1]) : "";
}

function attrOf(html, tagRe) {
  const m = html.match(tagRe);
  return m ? decodeEntities(m[1].trim()) : "";
}

export function cleanText(htmlish) {
  let s = String(htmlish || "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|figcaption|section)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

export function normalizeDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dots = s.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (dots) {
    return `${dots[1]}-${String(dots[2]).padStart(2, "0")}-${String(dots[3]).padStart(2, "0")}`;
  }
  const kor = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (kor) {
    return `${kor[1]}-${String(kor[2]).padStart(2, "0")}-${String(kor[3]).padStart(2, "0")}`;
  }
  return "";
}

export function pressFromHost(pageUrl) {
  if (!pageUrl) return "";
  let host = "";
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
  if (PRESS_MAP[host]) return PRESS_MAP[host];
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const slice = parts.slice(i).join(".");
    if (PRESS_MAP[slice]) return PRESS_MAP[slice];
  }
  return "";
}

function stripChrome(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
}

function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBalanced(html, openRe) {
  const copy = new RegExp(openRe.source, openRe.flags.includes("g") ? openRe.flags : openRe.flags + "g");
  copy.lastIndex = 0;
  const m = copy.exec(html);
  if (!m) return "";
  const tagMatch = m[0].match(/^<([a-z0-9]+)/i);
  if (!tagMatch) return "";
  const tag = tagMatch[1];
  const start = m.index + m[0].length;
  const tokenRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  tokenRe.lastIndex = start;
  let depth = 1;
  let tok;
  while ((tok = tokenRe.exec(html))) {
    if (/^<\//.test(tok[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, tok.index);
    if (tok.index - start > 400000) break;
  }
  return "";
}

function findBySelector(html, selector) {
  if (selector.startsWith("[itemprop=")) {
    const name = selector.match(/itemprop="([^"]+)"/)[1];
    return extractBalanced(
      html,
      new RegExp(`<(div|section|article|td)\\b[^>]*\\bitemprop=["']${escRe(name)}["'][^>]*>`, "i")
    );
  }
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    return extractBalanced(
      html,
      new RegExp(`<(div|section|article|td)\\b[^>]*\\bid=["']${escRe(id)}["'][^>]*>`, "i")
    );
  }
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return extractBalanced(
      html,
      new RegExp(`<(div|section|article|td)\\b[^>]*\\bclass=["'][^"']*\\b${escRe(cls)}\\b[^"']*["'][^>]*>`, "i")
    );
  }
  if (selector === "article") {
    return extractBalanced(html, /<article\b[^>]*>/i);
  }
  return "";
}

function looksLikeNav(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 8) {
    const short = lines.filter((l) => l.length <= 14).length;
    if (short / lines.length > 0.65) return true;
  }
  if ((text.match(/홈/g) || []).length >= 5 && text.length < 2500) return true;
  return false;
}

function scoreChunk(chunk) {
  const text = cleanText(chunk);
  if (text.length < 80) return 0;
  if (looksLikeNav(text)) return 0;
  const ps = (chunk.match(/<p\b/gi) || []).length;
  const links = (chunk.match(/<a\b/gi) || []).length;
  const sentences = (text.match(/[.!?。]\s|\n/g) || []).length;
  return text.length + ps * 80 + sentences * 12 - links * 25;
}

function bestLooseChunk(html) {
  const re = /<(div|section|article)\b[^>]*>/gi;
  let best = "";
  let bestScore = 0;
  let m;
  let guard = 0;
  while ((m = re.exec(html)) && guard++ < 250) {
    const inner = extractBalanced(html, new RegExp(escRe(m[0])));
    if (!inner || inner.length > 300000) continue;
    const sc = scoreChunk(inner);
    if (sc > bestScore) {
      bestScore = sc;
      best = inner;
    }
  }
  return best;
}

export function extractArticle(html, pageUrl) {
  const raw = String(html || "");
  let title =
    metaContent(raw, ["og:title", "twitter:title", "headline"]) ||
    tagText(raw, "title") ||
    tagText(raw, "h1");
  title = title.replace(/\s+[|｜–—-]\s+.*$/, "").trim() || title;
  title = title.slice(0, 300);

  let press =
    metaContent(raw, ["og:site_name", "application-name", "publisher"]) ||
    pressFromHost(pageUrl);
  if (/네이버|naver|다음|daum/i.test(press) || /naver\.com|daum\.net/i.test(String(pageUrl || ""))) {
    const real =
      metaContent(raw, ["twitter:creator", "og:article:author", "article:author"]) || "";
    const cleaned = real.replace(/\s*[|｜].*$/, "").trim();
    if (cleaned && !/네이버|naver|다음|daum/i.test(cleaned)) press = cleaned;
  }

  let date = normalizeDate(
    metaContent(raw, [
      "article:published_time",
      "og:article:published_time",
      "og:published_time",
      "article:published",
      "pubdate",
      "publishdate",
      "datePublished",
      "date",
      "dc.date"
    ])
  );
  if (!date) {
    const nv = raw.match(/data-date-time\s*=\s*["'](\d{4}-\d{2}-\d{2})/i);
    if (nv) date = nv[1];
  }
  if (!date) {
    const time = attrOf(raw, /<time[^>]+datetime=["']([^"']+)["']/i);
    date = normalizeDate(time);
  }
  if (!date) {
    const ld = raw.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    if (ld) date = normalizeDate(ld[1]);
  }

  const stripped = stripChrome(raw);
  let bodyHtml = "";
  for (const sel of BODY_SELECTORS) {
    const chunk = findBySelector(stripped, sel);
    const text = cleanText(chunk);
    if (text.length >= 80 && !looksLikeNav(text)) {
      bodyHtml = chunk;
      break;
    }
  }
  if (!bodyHtml || cleanText(bodyHtml).length < 120) {
    const loose = bestLooseChunk(stripped);
    if (scoreChunk(loose) > scoreChunk(bodyHtml)) bodyHtml = loose;
  }

  let text = cleanText(bodyHtml);
  const paras = [];
  const paraTags = String(bodyHtml || "").match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  for (const p of paraTags) {
    const pt = cleanText(p);
    if (pt.length >= 40) paras.push(pt);
  }
  const paraText = paras.join("\n\n");
  if (paraText.length >= 200 || (paraText.length > 80 && paraText.length * 2 >= text.length * 0.5)) {
    text = paraText;
  }
  if (text.length < 80) {
    const ps = [];
    const pre = stripped.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    for (const p of pre) {
      const pt = cleanText(p);
      if (pt.length >= 40) ps.push(pt);
    }
    if (ps.join("\n").length > text.length) text = ps.join("\n\n");
  }
  if (text.length > MAX_ARTICLE_CHARS) {
    text = text.slice(0, MAX_ARTICLE_CHARS) + "\n…";
  }

  return { title, press, date, text };
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", description: "YYYY-MM-DD, 모르면 빈 문자열" },
    title: { type: "string" },
    press: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    keyNumbers: { type: "string", description: "기사에 나온 핵심 숫자만. 없으면 빈 문자열" },
    what: { type: "string", description: "무슨 일이 벌어졌는지 자세히. 4~7문장, 기사 속 숫자·주체·시점 포함, 각 문장 -함/-임체" },
    why: { type: "string", description: "왜 벌어졌는지 원인과 배경을 자세히. 원인별로 '- ' 글머리 3~6줄, 각 줄에 근거 포함" },
    who: { type: "array", items: { type: "string" } },
    whoDetail: { type: "string", description: "who에서 고른 대상마다 한 줄씩 '대상: 어떤 영향을 어떻게 받는지'. 줄바꿈으로 구분" },
    whyImportant: { type: "string" },
    investmentUp: { type: "string" },
    investmentDown: { type: "string" },
    investmentReason: { type: "string" },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string", description: "용어 이름만. 짧은 단어나 구 (예: 고대역폭메모리(HBM)). 문장 금지" },
          meaning: { type: "string", description: "초보자도 이해할 쉬운 뜻 1~2문장, -함/-임체" }
        },
        required: ["term", "meaning"]
      }
    },
    watch: { type: "string" }
  },
  required: ["title", "what"]
};

function buildPrompt(extracted, pageUrl) {
  return [
    "당신은 초보 학습자를 돕는 경제 뉴스 정리 도우미입니다.",
    "",
    "규칙:",
    "- 쉬운 한국어로 짧고 분명하게 쓰세요.",
    "- 모든 칸의 문장은 존댓말 대신 개조식 명사형 어미(-함, -임, -됨, -음, -전망, -예정 등)로 끝내세요. 예: '코스피 4% 상승함', '외국인 순매수 영향임'. '-요', '-니다', '-다'로 끝내지 마세요.",
    "- title은 '이미 파악된 정보'의 제목이 있으면 한 글자도 바꾸지 말고 그대로 쓰세요.",
    "- 아래 기사에 나온 사실만 사용하세요. 추측하거나, 기사에 없는 숫자를 만들지 마세요.",
    "- 기사에 없는 핵심 숫자나 사실은 해당 칸을 비워 두세요.",
    `- tags는 가능한 한 다음 목록에서 고르세요: ${PRESET_TAGS.join(", ")}. 꼭 필요할 때만 새 태그를 추가하세요.`,
    `- who는 다음 중에서만, 해당되는 것을 모두 고르세요: ${WHO_OPTIONS.join(", ")}.`,
    "- 투자 관점(investmentUp, investmentDown, investmentReason)은 일반적 가능성으로만 적으세요. 투자 조언이나 매수·매도 권유가 아닙니다.",
    "- date는 '이미 파악된 정보'의 날짜가 있으면 그대로 쓰고, 없으면 기사에 적힌 게시일만 YYYY-MM-DD로 적으세요. 기사 속 사건 날짜(예: '어제', '10일')로 추측하지 마세요.",
    "- what(무슨 일이 벌어졌나)은 최대한 자세히 쓰세요. 4~7문장으로, 기사에 나온 숫자·주체(기업, 기관, 투자자)·시점을 빠짐없이 넣으세요.",
    "- why(왜 벌어졌나)는 원인과 배경을 최대한 자세히 쓰세요. 원인마다 '- '로 시작하는 줄로 3~6줄 쓰고, 각 줄에 기사 속 근거를 함께 쓰세요.",
    "- whoDetail은 who에서 고른 대상마다 한 줄씩 '대상: 어떤 영향을 어떻게 받는지' 형식으로 쓰세요. 예: '예금자/투자자: 반도체주 목표가 하향으로 단기 주가 부담이 커질 수 있음'. 줄바꿈으로 구분하세요.",
    "- terms는 기사에 나온 경제 용어 2~5개를 고르세요. term에는 용어 이름만(짧은 단어), meaning에는 쉬운 뜻을 쓰세요. term에 문장을 넣지 마세요.",
    "- 내 생각이나 후속 결과는 적지 마세요.",
    "",
    "이미 파악된 정보:",
    `제목: ${extracted.title || "(없음)"}`,
    `언론사: ${extracted.press || "(없음)"}`,
    `날짜: ${extracted.date || "(없음)"}`,
    `링크: ${pageUrl || "(없음)"}`,
    "",
    "기사 본문:",
    extracted.text || "(본문 없음)"
  ].join("\n");
}

export function parseGeminiJson(rawText) {
  let s = String(rawText || "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) s = fenced[1].trim();
  return JSON.parse(s);
}

export function normalizeAutofill(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fb = fallback || {};
  const tags = Array.isArray(src.tags) ? src.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const who = Array.isArray(src.who)
    ? src.who.map((w) => String(w).trim()).filter((w) => WHO_OPTIONS.includes(w))
    : [];
  let terms = [];
  if (Array.isArray(src.terms)) {
    terms = src.terms
      .map((t) => {
        if (!t) return null;
        let term, meaning;
        if (typeof t === "string") {
          const m = t.match(/^\s*([^:：\-–—]{1,30})\s*[:：\-–—]\s*(.+)$/);
          term = m ? m[1].trim() : t.trim();
          meaning = m ? m[2].trim() : "";
        } else {
          term = String(t.term || t.name || "").trim();
          meaning = String(t.meaning || t.definition || t.desc || "").trim();
        }
        if (!term) return null;
        if (term.length > 30 || /(함|임|됨|음|다|요)\s*[.]?$/.test(term) && term.length > 15) return null;
        return { term, meaning };
      })
      .filter(Boolean);
  }
  const invest = src.investment && typeof src.investment === "object" ? src.investment : {};
  const date = normalizeDate(src.date) || normalizeDate(fb.date) || "";
  return {
    date,
    title: String(src.title || fb.title || "").trim(),
    press: String(src.press || fb.press || "").trim(),
    tags,
    keyNumbers: String(src.keyNumbers || "").trim(),
    what: String(src.what || "").trim(),
    why: String(src.why || "").trim(),
    who,
    whoDetail: String(src.whoDetail || "").trim(),
    whyImportant: String(src.whyImportant || "").trim(),
    investmentUp: String(src.investmentUp || src.investFavorable || invest.up || "").trim(),
    investmentDown: String(src.investmentDown || src.investUnfavorable || invest.down || "").trim(),
    investmentReason: String(src.investmentReason || src.investReason || invest.reason || "").trim(),
    terms,
    watch: String(src.watch || "").trim()
  };
}

function parseRequestBody(event) {
  let raw = event && event.body;
  if (raw == null || raw === "") return {};
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  if (typeof raw !== "string") return raw;
  return JSON.parse(raw);
}

async function fetchWithTimeout(fetchFn, url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchArticleHtml(url, fetchFn) {
  const res = await fetchWithTimeout(
    fetchFn,
    url,
    {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    },
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) {
    const err = new Error("fetch_http");
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const html = decodeHtmlBuffer(buf, res.headers.get("content-type") || "");
  const finalUrl = res.url || url;
  return { html, finalUrl };
}

export async function callGemini({ fetchFn, apiKey, model, prompt, noSchema, timeoutMs }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;
  const res = await fetchWithTimeout(
    fetchFn,
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          ...(noSchema ? {} : { responseSchema: RESPONSE_SCHEMA })
        }
      })
    },
    timeoutMs || GEMINI_TIMEOUT_MS
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("gemini_http");
    err.status = res.status;
    err.details = data;
    throw err;
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    const err = new Error("gemini_blocked");
    throw err;
  }
  const text =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts.map((p) => p.text || "").join("");
  if (!text) {
    const err = new Error("gemini_empty");
    throw err;
  }
  return parseGeminiJson(text);
}

export async function handleAutofill(event, deps) {
  const startedAt = Date.now();
  const fetchFn = (deps && deps.fetch) || fetch;
  const env = (deps && deps.env) || process.env;
  const method = (event && event.httpMethod) || "GET";

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: { "Content-Type": "application/json" }, body: "" };
  }
  if (method !== "POST") {
    return json(405, { error: "POST로 요청해 주세요." });
  }

  let payload;
  try {
    payload = parseRequestBody(event);
  } catch {
    return json(400, { error: "요청 형식이 올바르지 않아요." });
  }

  const url = String((payload && payload.url) || "").trim();
  const pasted = String((payload && payload.text) || "").trim();

  if (!url && !pasted) {
    return json(400, { error: "기사 링크를 넣거나, 본문을 붙여넣어 주세요." });
  }
  if (url && !isAllowedUrl(url)) {
    return json(400, { error: "올바른 링크(http 또는 https)를 넣어 주세요." });
  }

  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  if (!apiKey) {
    return json(500, {
      error: "Gemini API 키가 설정되지 않았어요. Netlify 환경 변수에 GEMINI_API_KEY를 넣어 주세요."
    });
  }

  let extracted = { title: "", press: pressFromHost(url), date: "", text: "" };
  if (pasted) {
    extracted.text = pasted.length > MAX_ARTICLE_CHARS ? pasted.slice(0, MAX_ARTICLE_CHARS) + "\n…" : pasted;
    const firstLine = pasted.split(/\n/)[0].trim();
    if (firstLine.length >= 8 && firstLine.length <= 200) extracted.title = firstLine;
  } else {
    try {
      const { html, finalUrl } = await fetchArticleHtml(url, fetchFn);
      extracted = extractArticle(html, finalUrl || url);
      if (!extracted.press) extracted.press = pressFromHost(finalUrl || url);
    } catch (err) {
      if (err && (err.name === "AbortError" || err.message === "The operation was aborted")) {
        return json(422, {
          error: "기사 페이지를 가져오는 시간이 너무 길어요. 본문을 직접 붙여넣은 뒤 다시 시도해 주세요."
        });
      }
      return json(422, {
        error: "기사 페이지를 가져오지 못했어요. 본문을 직접 붙여넣은 뒤 다시 시도해 주세요."
      });
    }
    if (!extracted.text || extracted.text.length < 40) {
      return json(422, {
        error: "기사 본문을 찾지 못했어요. 본문을 직접 붙여넣은 뒤 다시 시도해 주세요."
      });
    }
  }

  const model = String(env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  try {
    const prompt = buildPrompt(extracted, url);
    let raw;
    const busy = (e) => e && (e.status === 503 || e.status === 500 || e.status === 429 || e.name === "AbortError");
    const deadline = startedAt + 24000;
    const tryModels = async () => {
      const models = [model, "gemini-flash-lite-latest", "gemini-flash-latest"].filter((m, i, a) => a.indexOf(m) === i);
      let last;
      for (let i = 0; i < models.length; i++) {
        const left = deadline - Date.now();
        if (left < 3000) break;
        const isLast = i === models.length - 1;
        const timeoutMs = isLast ? left : Math.min(left, i === 0 ? 11000 : 9000);
        try {
          return await callGemini({ fetchFn, apiKey, model: models[i], prompt, timeoutMs });
        } catch (e) {
          last = e;
          if (!busy(e) && !(e && e.status === 404)) throw e;
        }
      }
      throw last || Object.assign(new Error("timeout"), { name: "AbortError" });
    };
    try {
      raw = await tryModels();
    } catch (e1) {
      const m1 = String((e1 && e1.details && e1.details.error && e1.details.error.message) || "");
      if (e1 && e1.status === 404 && model !== "gemini-flash-latest") {
        raw = await callGemini({ fetchFn, apiKey, model: "gemini-flash-latest", prompt });
      } else if (e1 && e1.status === 400 && !/api key/i.test(m1)) {
        raw = await callGemini({ fetchFn, apiKey, model, prompt, noSchema: true });
      } else {
        throw e1;
      }
    }
    const result = normalizeAutofill(raw, extracted);
    if (extracted.title) result.title = extracted.title;
    if (extracted.press) result.press = extracted.press;
    if (extracted.date) result.date = extracted.date;
    return json(200, result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return json(502, { error: "글을 정리한 결과를 읽지 못했어요. 잠시 후 다시 시도해 주세요." });
    }
    return json(502, { error: describeGeminiError(err, model) });
  }
}

function describeGeminiError(err, model) {
  const st = err && err.status;
  const d = (err && err.details && err.details.error) || {};
  const msg = String(d.message || "").slice(0, 200);
  const reason = String(d.status || "");
  let head = "글을 정리하는 중 오류가 났어요.";
  if (err && err.name === "AbortError") head = "Gemini 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.";
  else if (err && err.message === "gemini_blocked") head = "Gemini가 이 글 정리를 거절했어요.";
  else if (err && err.message === "gemini_empty") head = "Gemini가 빈 답을 보냈어요. 다시 시도해 주세요.";
  else if (st === 400 && /api key|API_KEY/i.test(msg + reason)) head = "Gemini API 키가 올바르지 않아요. AI Studio에서 키를 다시 복사해 Netlify에 넣어 주세요.";
  else if (st === 401 || st === 403) head = "Gemini API 키 권한 문제예요. 키를 다시 확인해 주세요.";
  else if (st === 404) head = "Gemini 모델(" + model + ")을 찾지 못했어요.";
  else if (st === 429) head = "Gemini 무료 사용량을 잠시 넘었어요. 1분쯤 뒤 다시 시도해 주세요.";
  else if (st >= 500) head = "Gemini 서버가 잠시 불안정해요. 잠시 후 다시 시도해 주세요.";
  const detail = st ? " [" + st + (reason ? " " + reason : "") + (msg ? ": " + msg : "") + "]" : (err && err.message ? " [" + err.message + "]" : "");
  return head + detail;
}

export async function handler(event, context) {
  return handleAutofill(event, { fetch, env: process.env });
}
