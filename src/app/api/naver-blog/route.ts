import { getNaverBlogPostData } from '@/app/_lib/naver-blog';

export const runtime = 'nodejs';

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
    const data = await getNaverBlogPostData(url);

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
