import { getNaverBlogPostData } from '@/app/_lib/naver-blog';

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
    return Response.json(
      { error: 'url 파라미터가 필요합니다.' },
      { status: 400 },
    );
  }

  try {
    const normalizedUrl = normalizeNaverBlogUrl(url);
    const data = await getNaverBlogPostData(normalizedUrl);

    return Response.json({
      title: data.title,
      imageCount: data.images.length,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '블로그 정보를 가져오지 못했습니다.',
      },
      { status: 500 },
    );
  }
}
