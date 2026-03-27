import {
  buildArticleTextFile,
  getNaverBlogPostData,
  safeFilename,
} from '@/app/_lib/naver-blog';

export const runtime = 'nodejs';

function normalizeNaverBlogUrl(rawUrl: string) {
  const url = new URL(rawUrl);

  if (
    url.hostname !== 'blog.naver.com' &&
    url.hostname !== 'm.blog.naver.com'
  ) {
    throw new Error('네이버 블로그 URL만 입력할 수 있습니다.');
  }

  if (url.hostname === 'm.blog.naver.com') {
    url.hostname = 'blog.naver.com';
  }

  url.hash = '';

  return url.toString();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response('url 파라미터가 필요합니다.', { status: 400 });
  }

  try {
    const normalizedUrl = normalizeNaverBlogUrl(url);
    const data = await getNaverBlogPostData(normalizedUrl);

    const text = buildArticleTextFile(data.title, data.contentText);
    const fileName = `${safeFilename(data.title) || 'naver-blog-article'}.txt`;

    return new Response(`\uFEFF${text}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          fileName,
        )}`,
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'TXT 파일 생성에 실패했습니다.',
      { status: 500 },
    );
  }
}
