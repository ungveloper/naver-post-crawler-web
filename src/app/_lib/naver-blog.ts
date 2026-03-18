import * as cheerio from 'cheerio';
import JSZip from 'jszip';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

type BlogPostData = {
  title: string;
  images: string[];
  sourceUrl: string;
  resolvedUrl: string;
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

  // 모바일 주소면 그대로 사용
  if (url.hostname === 'm.blog.naver.com') {
    return url.toString();
  }

  const outerHtml = await fetchHtml(url.toString());

  // 일반 blog.naver.com 주소는 mainFrame 안에 실제 본문이 있는 경우가 많음
  const iframeMatch = outerHtml.match(
    /<iframe[^>]*id=["']?mainFrame["']?[^>]*src=["']([^"']+)["']/i,
  );

  if (iframeMatch?.[1]) {
    return toAbsoluteUrl('https://blog.naver.com', iframeMatch[1]);
  }

  return url.toString();
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

function parseDataLinkData(raw: string): unknown {
  const trimmed = raw.trim();

  const candidates = [
    trimmed,
    decodeHtmlEntities(trimmed),
    (() => {
      try {
        return decodeURIComponent(trimmed);
      } catch {
        return '';
      }
    })(),
    (() => {
      try {
        return decodeURIComponent(decodeHtmlEntities(trimmed));
      } catch {
        return '';
      }
    })(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
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

    // viewer.html?src=... 형태면 실제 원본 URL로 복원
    const encodedSrc = url.searchParams.get('src');
    if (encodedSrc) {
      try {
        const decoded = decodeURIComponent(encodedSrc);
        if (/pstatic\.net/i.test(decoded)) {
          return normalizeImageUrl(decoded, baseUrl);
        }
      } catch {
        // ignore
      }
    }

    // 미리보기/리사이즈용 파라미터 제거
    url.searchParams.delete('type');

    return url.toString();
  } catch {
    return absolute;
  }
}

function getImageKey(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return imageUrl;
  }
}

function isBetterImageUrl(nextUrl: string, prevUrl?: string) {
  if (!prevUrl) return true;

  try {
    const next = new URL(nextUrl);
    const prev = new URL(prevUrl);

    const nextType = next.searchParams.get('type');
    const prevType = prev.searchParams.get('type');

    // type 파라미터가 없는 쪽을 더 원본에 가깝다고 판단
    if (!nextType && prevType) return true;
    if (nextType && !prevType) return false;

    return nextUrl.length >= prevUrl.length;
  } catch {
    return true;
  }
}

function extractImageUrls(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string,
) {
  const originals = new Map<string, string>();

  const addOriginal = (raw?: string | null) => {
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

    const key = getImageKey(normalized);
    const prev = originals.get(key);

    if (isBetterImageUrl(normalized, prev)) {
      originals.set(key, normalized);
    }
  };

  // 1순위: data-linkdata 내부의 원본 src
  $('a[data-linktype="img"][data-linkdata]').each((_, el) => {
    const raw = $(el).attr('data-linkdata');
    if (!raw) return;

    const parsed = parseDataLinkData(raw);

    if (!parsed) return;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'src' in parsed &&
      typeof (parsed as { src?: unknown }).src === 'string'
    ) {
      addOriginal((parsed as { src: string }).src);
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (
          typeof item === 'object' &&
          item !== null &&
          'src' in item &&
          typeof (item as { src?: unknown }).src === 'string'
        ) {
          addOriginal((item as { src: string }).src);
        }
      }
    }
  });

  // 2순위: 본문 HTML에서 원본 URL 직접 추출
  if (originals.size === 0) {
    const matches =
      html.match(
        /https?:\/\/[^\s"'<>]+(?:blogfiles|postfiles|mblogthumb-phinf|post-phinf|blogpfthumb-phinf)\.pstatic\.net[^\s"'<>]*/gi,
      ) || [];

    for (const match of matches) {
      addOriginal(match);
    }
  }

  // 3순위: fallback으로 img 태그 수집
  if (originals.size === 0) {
    const selectors = [
      '.se-main-container img',
      '#postViewArea img',
      '.post-view img',
      '.view img',
      'img',
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const node = $(el);
        addOriginal(node.attr('data-src'));
        addOriginal(node.attr('data-lazy-src'));
        addOriginal(node.attr('data-lw_src'));
        addOriginal(node.attr('src'));
      });

      if (originals.size > 0) break;
    }
  }

  return Array.from(originals.values());
}

export async function getNaverBlogPostData(
  inputUrl: string,
): Promise<BlogPostData> {
  const resolvedUrl = await resolveInnerPostUrl(inputUrl);
  const html = await fetchHtml(resolvedUrl);
  const $ = cheerio.load(html);

  const title = extractTitle($, html);
  const images = extractImageUrls($, html, resolvedUrl);

  return {
    title,
    images,
    sourceUrl: inputUrl,
    resolvedUrl,
  };
}

function detectExtension(imageUrl: string, contentType: string | null) {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('gif')) return 'gif';
  if (contentType?.includes('bmp')) return 'bmp';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg'))
    return 'jpg';

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
      // 개별 이미지 실패는 무시하고 계속 진행
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
