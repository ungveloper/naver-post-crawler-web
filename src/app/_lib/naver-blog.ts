import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import JSZip from 'jszip';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

type BlogPostData = {
  title: string;
  images: string[];
  contentText: string;
  contentHtml: string;
  sourceUrl: string;
  resolvedUrl: string;
};

type MobilePhotoEntry = {
  path?: string;
  id?: string;
};

export function safeFilename(name: string) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function toAbsoluteUrl(baseUrl: string, target: string) {
  try {
    return new URL(target, baseUrl).toString();
  } catch {
    return '';
  }
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`페이지를 불러오지 못했습니다. (${res.status})`);
  }

  return res.text();
}

async function resolveInnerPostUrl(inputUrl: string) {
  const url = new URL(inputUrl);

  if (url.hostname === 'm.blog.naver.com') {
    return url.toString();
  }

  const outerHtml = await fetchHtml(url.toString());

  const iframeMatch = outerHtml.match(
    /<iframe[^>]*id=["']?mainFrame["']?[^>]*src=["']([^"']+)["']/i,
  );

  if (iframeMatch?.[1]) {
    return toAbsoluteUrl('https://blog.naver.com', iframeMatch[1]);
  }

  return url.toString();
}

function toMobilePostUrl(resolvedUrl: string) {
  const url = new URL(resolvedUrl);

  if (url.hostname === 'm.blog.naver.com') {
    return url.toString();
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (
    url.hostname === 'blog.naver.com' &&
    parts.length >= 2 &&
    parts[0] !== 'PostView.naver'
  ) {
    return `https://m.blog.naver.com/${parts[0]}/${parts[1]}`;
  }

  if (
    url.pathname.endsWith('/PostView.naver') ||
    url.pathname === '/PostView.naver'
  ) {
    const blogId = url.searchParams.get('blogId');
    const logNo = url.searchParams.get('logNo');

    if (blogId && logNo) {
      return `https://m.blog.naver.com/${blogId}/${logNo}`;
    }
  }

  throw new Error('모바일 포스트 URL로 변환하지 못했습니다.');
}

async function resolveMobilePostUrl(inputUrl: string) {
  const resolved = await resolveInnerPostUrl(inputUrl);
  return toMobilePostUrl(resolved);
}

function extractTitle($: cheerio.CheerioAPI, html: string) {
  const candidates = [
    $('meta[property="og:title"]').attr('content'),
    $('meta[name="title"]').attr('content'),
    $('.se-title-text span').first().text(),
    $('.pcol1 .htitle').first().text(),
    $('title').first().text(),
  ];

  for (const item of candidates) {
    const value = (item || '').replace(/\s+/g, ' ').trim();
    if (value) return value;
  }

  const regexMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (regexMatch?.[1]) {
    return regexMatch[1].trim();
  }

  return '네이버 블로그 이미지';
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseJsonSafely<T>(raw: string): T | null {
  const candidates = [
    raw,
    decodeHtmlEntities(raw),
    (() => {
      try {
        return decodeURIComponent(raw);
      } catch {
        return '';
      }
    })(),
    (() => {
      try {
        return decodeURIComponent(decodeHtmlEntities(raw));
      } catch {
        return '';
      }
    })(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue
    }
  }

  return null;
}

function normalizeImageUrl(rawUrl: string, baseUrl: string) {
  const absolute = toAbsoluteUrl(baseUrl, rawUrl.replace(/&amp;/g, '&').trim());
  if (!absolute) return '';

  try {
    const url = new URL(absolute);

    const encodedSrc = url.searchParams.get('src');
    if (encodedSrc) {
      try {
        return normalizeImageUrl(decodeURIComponent(encodedSrc), baseUrl);
      } catch {
        // ignore
      }
    }

    url.searchParams.delete('type');
    url.searchParams.delete('w');
    url.searchParams.delete('h');
    url.searchParams.delete('size');

    return url.toString();
  } catch {
    return absolute;
  }
}

function normalizeSrcsetValue(rawSrcset: string, baseUrl: string) {
  return rawSrcset
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rawUrl, ...descriptors] = item.split(/\s+/);
      const normalized = normalizeImageUrl(rawUrl, baseUrl);
      if (!normalized) return '';

      return [normalized, ...descriptors].join(' ').trim();
    })
    .filter(Boolean)
    .join(', ');
}

function getImageKey(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return imageUrl;
  }
}

function normalizeMobileOriginalPath(path: string) {
  const trimmed = decodeHtmlEntities(path).trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeImageUrl(trimmed, 'https://blogfiles.pstatic.net');
  }

  if (trimmed.startsWith('//')) {
    return normalizeImageUrl(
      `https:${trimmed}`,
      'https://blogfiles.pstatic.net',
    );
  }

  return normalizeImageUrl(
    `https://blogfiles.pstatic.net${trimmed.startsWith('/') ? '' : '/'}${trimmed}`,
    'https://blogfiles.pstatic.net',
  );
}

function parseAttachImagePathAndIdInfo(raw: string) {
  const parsed = parseJsonSafely<MobilePhotoEntry[]>(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => (typeof item?.path === 'string' ? item.path : ''))
      .filter(Boolean);
  }

  const decoded = decodeHtmlEntities(raw);
  const matches = decoded.match(/"path"\s*:\s*"([^"]+)"/g) || [];

  return matches
    .map((chunk) => {
      const match = chunk.match(/"path"\s*:\s*"([^"]+)"/);
      return match?.[1] || '';
    })
    .filter(Boolean);
}

function extractOriginalImageUrlsFromMobileProperty($: cheerio.CheerioAPI) {
  const photoBox = $('#_photo_view_property').first();
  const raw = photoBox.attr('attachimagepathandidinfo');

  if (!raw) {
    return [];
  }

  const paths = parseAttachImagePathAndIdInfo(raw);
  const dedup = new Map<string, string>();

  for (const path of paths) {
    const normalized = normalizeMobileOriginalPath(path);
    if (!normalized) continue;

    dedup.set(getImageKey(normalized), normalized);
  }

  return Array.from(dedup.values());
}

function getPostRoot($: cheerio.CheerioAPI) {
  const selectors = [
    '.se-main-container',
    '#postViewArea',
    '.post-view',
    '.view',
  ];

  for (const selector of selectors) {
    const root = $(selector).first();
    if (root.length > 0) {
      return root;
    }
  }

  return null;
}

function extractSrcListFromLinkData(parsed: unknown) {
  const result: string[] = [];

  const pushSrc = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      result.push(value);
    }
  };

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    pushSrc((parsed as { src?: unknown }).src);
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === 'object' && item !== null) {
        pushSrc((item as { src?: unknown }).src);
      }
    }
  }

  return result;
}

function extractFallbackImageUrls(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string,
) {
  const originals = new Map<string, string>();
  const root = getPostRoot($);

  const add = (raw?: string | null) => {
    if (!raw) return;

    const normalized = normalizeImageUrl(raw, baseUrl);
    if (!normalized) return;

    if (
      normalized.includes('ssl.pstatic.net/static') ||
      normalized.includes('/favicon.ico') ||
      normalized.includes('blank.gif')
    ) {
      return;
    }

    originals.set(getImageKey(normalized), normalized);
  };

  if (root) {
    root.find('a[data-linktype="img"][data-linkdata]').each((_, el) => {
      const raw = $(el).attr('data-linkdata');
      if (!raw) return;

      const parsed = parseJsonSafely<unknown>(raw);
      if (!parsed) return;

      for (const src of extractSrcListFromLinkData(parsed)) {
        add(src);
      }
    });
  }

  if (originals.size === 0 && root) {
    root.find('img').each((_, el) => {
      const node = $(el);

      add(node.attr('data-lazy-src'));
      add(node.attr('data-src'));
      add(node.attr('data-lw_src'));
      add(node.attr('src'));
    });
  }

  if (originals.size === 0) {
    const targetHtml = root ? root.html() || '' : html;
    const matches =
      targetHtml.match(
        /https?:\/\/[^\s"'<>]+(?:blogfiles|postfiles|mblogthumb-phinf|post-phinf|blogpfthumb-phinf)\.pstatic\.net[^\s"'<>]*/gi,
      ) || [];

    for (const match of matches) {
      add(match);
    }
  }

  return Array.from(originals.values());
}

function extractImageUrls(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string,
) {
  const mobileOriginals = extractOriginalImageUrlsFromMobileProperty($);
  if (mobileOriginals.length > 0) {
    return mobileOriginals;
  }

  return extractFallbackImageUrls($, html, baseUrl);
}

function normalizeTextOutput(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSkippableImageUrl(url: string) {
  return (
    url.includes('ssl.pstatic.net/static') ||
    url.includes('/favicon.ico') ||
    url.includes('blank.gif')
  );
}

function getFirstUrlFromSrcset(value?: string | null) {
  if (!value) return '';

  const first = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0];

  if (!first) return '';

  return first.split(/\s+/)[0] || '';
}

function extractImageUrlsFromDataLinkData(raw: string, baseUrl: string) {
  const parsed = parseJsonSafely<unknown>(raw);
  if (!parsed) return [];

  const dedup = new Map<string, string>();

  for (const src of extractSrcListFromLinkData(parsed)) {
    const normalized = normalizeImageUrl(src, baseUrl);
    if (!normalized) continue;
    if (isSkippableImageUrl(normalized)) continue;

    dedup.set(getImageKey(normalized), normalized);
  }

  return Array.from(dedup.values());
}

function getNodeImageUrlForText(
  node: cheerio.Cheerio<Element>,
  baseUrl: string,
) {
  const candidates = [
    node.attr('data-lazy-src'),
    node.attr('data-src'),
    node.attr('data-lw_src'),
    node.attr('src'),
    node.attr('poster'),
    getFirstUrlFromSrcset(node.attr('srcset')),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const normalized = normalizeImageUrl(candidate, baseUrl);
    if (!normalized) continue;
    if (isSkippableImageUrl(normalized)) continue;

    return normalized;
  }

  return '';
}

function findImageIndexFromCandidates(
  candidateUrls: string[],
  imageOrderMap: Map<string, number>,
) {
  for (const url of candidateUrls) {
    const index = imageOrderMap.get(getImageKey(url));
    if (index) return index;
  }

  return null;
}

function detectExtension(imageUrl: string, contentType: string | null) {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('gif')) return 'gif';
  if (contentType?.includes('bmp')) return 'bmp';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) {
    return 'jpg';
  }

  try {
    const pathname = new URL(imageUrl).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    // ignore
  }

  return 'jpg';
}

function buildTextImageMarker(index: number, orderedImageUrls: string[]) {
  const imageUrl = orderedImageUrls[index - 1] || '';
  const ext = detectExtension(imageUrl, null);

  return `(이미지-${String(index).padStart(3, '0')}.${ext})`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlImageLabel(index: number, orderedImageUrls: string[]) {
  return `<p class="article-image-label">${escapeHtml(
    buildTextImageMarker(index, orderedImageUrls),
  )}</p>`;
}

function extractArticleText(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string,
  orderedImageUrls: string[],
) {
  const root = getPostRoot($);
  const targetHtml = root ? $.html(root) : html;
  const $$ = cheerio.load(targetHtml);

  $$(
    'script, style, noscript, iframe, svg, canvas, button, input, textarea, select, option',
  ).remove();

  $$('#_photo_view_property').remove();

  const imageOrderMap = new Map<string, number>();
  orderedImageUrls.forEach((imageUrl, index) => {
    imageOrderMap.set(getImageKey(imageUrl), index + 1);
  });

  const usedIndexes = new Set<number>();
  let nextFallbackIndex = 1;

  const reserveImageIndex = (preferredIndex?: number | null) => {
    if (preferredIndex && !usedIndexes.has(preferredIndex)) {
      usedIndexes.add(preferredIndex);
      return preferredIndex;
    }

    while (nextFallbackIndex <= orderedImageUrls.length) {
      const current = nextFallbackIndex;
      nextFallbackIndex += 1;

      if (!usedIndexes.has(current)) {
        usedIndexes.add(current);
        return current;
      }
    }

    return null;
  };

  const replaceWithImageMarker = (
    node: cheerio.Cheerio<Element>,
    candidateUrls: string[],
  ) => {
    const matchedIndex = findImageIndexFromCandidates(
      candidateUrls,
      imageOrderMap,
    );

    const imageIndex = reserveImageIndex(matchedIndex);

    if (!imageIndex) {
      node.remove();
      return;
    }

    node.replaceWith(
      `\n${buildTextImageMarker(imageIndex, orderedImageUrls)}\n`,
    );
  };

  $$('br').replaceWith('\n');
  $$('hr').replaceWith('\n----------------------------------------\n');

  $$('a[data-linktype="img"][data-linkdata]').each((_, el) => {
    const node = $$(el);
    const raw = node.attr('data-linkdata');

    if (!raw) {
      node.remove();
      return;
    }

    const candidateUrls = extractImageUrlsFromDataLinkData(raw, baseUrl);

    if (candidateUrls.length === 0) {
      node.remove();
      return;
    }

    replaceWithImageMarker(node, candidateUrls);
  });

  $$('picture').each((_, el) => {
    const node = $$(el);
    const candidateUrls: string[] = [];

    const pictureUrl = getNodeImageUrlForText(node, baseUrl);
    if (pictureUrl) candidateUrls.push(pictureUrl);

    node.find('source, img').each((__, child) => {
      const childNode = $$(child);
      const childUrl = getNodeImageUrlForText(childNode, baseUrl);
      if (childUrl) candidateUrls.push(childUrl);
    });

    const dedup = Array.from(
      new Map(candidateUrls.map((url) => [getImageKey(url), url])).values(),
    );

    if (dedup.length === 0) {
      node.remove();
      return;
    }

    replaceWithImageMarker(node, dedup);
  });

  $$('img, video').each((_, el) => {
    const node = $$(el);
    const normalizedImageUrl = getNodeImageUrlForText(node, baseUrl);

    if (!normalizedImageUrl) {
      node.remove();
      return;
    }

    replaceWithImageMarker(node, [normalizedImageUrl]);
  });

  $$('source').remove();

  $$('li').each((_, el) => {
    const node = $$(el);
    if (node.text().trim()) {
      node.prepend('• ');
      node.append('\n');
    }
  });

  $$('td, th').each((_, el) => {
    const node = $$(el);
    if (node.text().trim()) {
      node.append('\t');
    }
  });

  $$('tr').each((_, el) => {
    const node = $$(el);
    if (node.text().trim()) {
      node.append('\n');
    }
  });

  $$(
    'p, div, section, article, header, footer, aside, blockquote, figcaption, h1, h2, h3, h4, h5, h6, ul, ol, table, pre',
  ).each((_, el) => {
    const node = $$(el);
    if (node.text().trim()) {
      node.append('\n');
    }
  });

  const text = normalizeTextOutput(decodeHtmlEntities($$.root().text()));

  return text || '본문을 추출하지 못했습니다.';
}

function extractArticleHtml(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string,
  orderedImageUrls: string[],
) {
  const root = getPostRoot($);
  const targetHtml = root ? $.html(root) : html;
  const $$ = cheerio.load(targetHtml);

  $$(
    'script, style, noscript, iframe, svg, canvas, button, input, textarea, select, option',
  ).remove();

  $$('#_photo_view_property').remove();

  $$('*').each((_, el) => {
    const node = $$(el);

    const src = node.attr('src');
    if (src) {
      const normalized = normalizeImageUrl(src, baseUrl);
      if (normalized) node.attr('src', normalized);
    }

    const dataSrc = node.attr('data-src');
    if (dataSrc) {
      const normalized = normalizeImageUrl(dataSrc, baseUrl);
      if (normalized) node.attr('src', normalized);
      node.removeAttr('data-src');
    }

    const lazySrc = node.attr('data-lazy-src');
    if (lazySrc) {
      const normalized = normalizeImageUrl(lazySrc, baseUrl);
      if (normalized) node.attr('src', normalized);
      node.removeAttr('data-lazy-src');
    }

    const poster = node.attr('poster');
    if (poster) {
      const normalized = normalizeImageUrl(poster, baseUrl);
      if (normalized) node.attr('poster', normalized);
    }

    const srcset = node.attr('srcset');
    if (srcset) {
      const normalized = normalizeSrcsetValue(srcset, baseUrl);
      if (normalized) {
        node.attr('srcset', normalized);
      } else {
        node.removeAttr('srcset');
      }
    }

    const href = node.attr('href');
    if (href) {
      const absoluteHref = toAbsoluteUrl(baseUrl, href);
      if (absoluteHref) node.attr('href', absoluteHref);
    }
  });

  const imageOrderMap = new Map<string, number>();
  orderedImageUrls.forEach((imageUrl, index) => {
    imageOrderMap.set(getImageKey(imageUrl), index + 1);
  });

  const usedIndexes = new Set<number>();
  let nextFallbackIndex = 1;

  const reserveImageIndex = (preferredIndex?: number | null) => {
    if (preferredIndex && !usedIndexes.has(preferredIndex)) {
      usedIndexes.add(preferredIndex);
      return preferredIndex;
    }

    while (nextFallbackIndex <= orderedImageUrls.length) {
      const current = nextFallbackIndex;
      nextFallbackIndex += 1;

      if (!usedIndexes.has(current)) {
        usedIndexes.add(current);
        return current;
      }
    }

    return null;
  };

  const insertImageLabel = (
    node: cheerio.Cheerio<Element>,
    candidateUrls: string[],
  ) => {
    const matchedIndex = findImageIndexFromCandidates(
      candidateUrls,
      imageOrderMap,
    );

    const imageIndex = reserveImageIndex(matchedIndex);
    if (!imageIndex) return;

    node.before(buildHtmlImageLabel(imageIndex, orderedImageUrls));
    node.attr('data-export-image-processed', '1');
    node
      .find('img, video, picture, source')
      .attr('data-export-image-skip', '1');
  };

  $$('a[data-linktype="img"][data-linkdata]').each((_, el) => {
    const node = $$(el);
    if (node.attr('data-export-image-skip') === '1') return;

    const raw = node.attr('data-linkdata');
    if (!raw) return;

    const candidateUrls = extractImageUrlsFromDataLinkData(raw, baseUrl);
    if (candidateUrls.length === 0) return;

    insertImageLabel(node, candidateUrls);
  });

  $$('picture').each((_, el) => {
    const node = $$(el);
    if (node.attr('data-export-image-skip') === '1') return;
    if (node.parents('a[data-linktype="img"][data-linkdata]').length > 0)
      return;

    const candidateUrls: string[] = [];

    const pictureUrl = getNodeImageUrlForText(node, baseUrl);
    if (pictureUrl) candidateUrls.push(pictureUrl);

    node.find('source, img').each((__, child) => {
      const childNode = $$(child);
      const childUrl = getNodeImageUrlForText(childNode, baseUrl);
      if (childUrl) candidateUrls.push(childUrl);
    });

    const dedup = Array.from(
      new Map(candidateUrls.map((url) => [getImageKey(url), url])).values(),
    );

    if (dedup.length === 0) return;

    insertImageLabel(node, dedup);
  });

  $$('img, video').each((_, el) => {
    const node = $$(el);
    if (node.attr('data-export-image-skip') === '1') return;
    if (node.parents('picture').length > 0) return;
    if (node.parents('a[data-linktype="img"][data-linkdata]').length > 0)
      return;

    const normalizedImageUrl = getNodeImageUrlForText(node, baseUrl);
    if (!normalizedImageUrl) return;

    insertImageLabel(node, [normalizedImageUrl]);
  });

  $$('[data-export-image-skip]').removeAttr('data-export-image-skip');
  $$('[data-export-image-processed]').removeAttr('data-export-image-processed');

  const bodyHtml = $$.root().html()?.trim();
  return bodyHtml || '<p>본문을 추출하지 못했습니다.</p>';
}

export function buildArticleTextFile(title: string, contentText: string) {
  return [title, '', contentText].join('\n').trim();
}

export function buildArticleHtmlFile(
  title: string,
  contentHtml: string,
  sourceUrl: string,
) {
  const safeTitle = escapeHtml(title || '네이버 블로그 글');
  const safeSourceUrl = escapeHtml(sourceUrl);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body {
        max-width: 860px;
        margin: 40px auto;
        padding: 0 20px;
        line-height: 1.7;
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
        word-break: break-word;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      a {
        color: #2563eb;
      }
      .article-header {
        margin-bottom: 32px;
        padding-bottom: 16px;
        border-bottom: 1px solid #e5e7eb;
      }
      .article-title {
        font-size: 28px;
        font-weight: 700;
        margin: 0 0 12px;
      }
      .article-source {
        font-size: 14px;
        color: #6b7280;
      }
      .article-image-label {
        margin: 20px 0 8px;
        font-size: 14px;
        line-height: 1.5;
        color: #4b5563;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
    </style>
  </head>
  <body>
    <header class="article-header">
      <h1 class="article-title">${safeTitle}</h1>
      <p class="article-source">
        원문:
        <a href="${safeSourceUrl}" target="_blank" rel="noopener noreferrer">${safeSourceUrl}</a>
      </p>
    </header>
    <main>
      ${contentHtml}
    </main>
  </body>
</html>`;
}

export async function getNaverBlogPostData(
  inputUrl: string,
): Promise<BlogPostData> {
  const resolvedUrl = await resolveMobilePostUrl(inputUrl);
  const html = await fetchHtml(resolvedUrl);
  const $ = cheerio.load(html);

  const title = extractTitle($, html);
  const images = extractImageUrls($, html, resolvedUrl);
  const contentText = extractArticleText($, html, resolvedUrl, images);
  const contentHtml = extractArticleHtml($, html, resolvedUrl, images);

  return {
    title,
    images,
    contentText,
    contentHtml,
    sourceUrl: inputUrl,
    resolvedUrl,
  };
}

export async function buildImageZip(
  title: string,
  imageUrls: string[],
  refererUrl: string,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const folderName = safeFilename(title) || 'naver-blog-images';
  const folder = zip.folder(folderName);

  if (!folder) {
    throw new Error('압축 폴더를 만들지 못했습니다.');
  }

  let successCount = 0;

  for (let i = 0; i < imageUrls.length; i += 1) {
    const imageUrl = imageUrls[i];

    try {
      const res = await fetch(imageUrl, {
        headers: {
          ...DEFAULT_HEADERS,
          Referer: refererUrl,
        },
        cache: 'no-store',
      });

      if (!res.ok) continue;

      const arrayBuffer = await res.arrayBuffer();
      const ext = detectExtension(imageUrl, res.headers.get('content-type'));
      const fileName = `${String(i + 1).padStart(3, '0')}.${ext}`;

      folder.file(fileName, arrayBuffer);
      successCount += 1;
    } catch {
      // 개별 이미지 실패는 무시
    }
  }

  if (successCount === 0) {
    throw new Error('다운로드 가능한 이미지를 찾지 못했습니다.');
  }

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
  });
}
