'use client';

import { SubmitEvent, useEffect, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';

export default function Home() {
  const [inputUrl, setInputUrl] = useState<string>('');
  const [submittedUrl, setSubmittedUrl] = useState<string>('');
  const [title, setTitle] = useState<string>('블로그 URL을 입력해 주세요.');
  const [imageCount, setImageCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;

    const fetchPostInfo = async () => {
      if (!submittedUrl) return;

      try {
        setLoading(true);
        setError('');
        setTitle('제목 불러오는 중...');
        setImageCount(0);

        const res = await fetch(
          `/api/naver-blog?url=${encodeURIComponent(submittedUrl)}`,
          { cache: 'no-store' },
        );

        const data = (await res.json()) as {
          title?: string;
          imageCount?: number;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || '제목을 가져오지 못했습니다.');
        }

        if (!ignore) {
          setTitle(data.title || '제목 없음');
          setImageCount(data.imageCount || 0);
        }
      } catch (error) {
        if (!ignore) {
          setError(
            error instanceof Error
              ? error.message
              : '알 수 없는 오류가 발생했습니다.',
          );
          setTitle('제목을 불러오지 못했습니다.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchPostInfo();

    return () => {
      ignore = true;
    };
  }, [submittedUrl]);

  const handleSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmed = inputUrl.trim();

    if (!trimmed) {
      setError('네이버 블로그 URL을 입력해 주세요.');
      setSubmittedUrl('');
      setTitle('블로그 URL을 입력해 주세요.');
      setImageCount(0);
      return;
    }

    try {
      const url = new URL(trimmed);

      if (
        !url.hostname.includes('blog.naver.com') &&
        !url.hostname.includes('m.blog.naver.com')
      ) {
        throw new Error('네이버 블로그 URL만 입력할 수 있습니다.');
      }

      setError('');
      setSubmittedUrl(trimmed);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '올바른 URL 형식이 아닙니다.',
      );
      setSubmittedUrl('');
      setTitle('올바른 URL을 입력해 주세요.');
      setImageCount(0);
    }
  };

  const handleDownload = () => {
    if (!submittedUrl) return;

    setDownloading(true);

    const downloadUrl = `/api/naver-blog/download?url=${encodeURIComponent(
      submittedUrl,
    )}`;

    window.location.href = downloadUrl;

    setTimeout(() => {
      setDownloading(false);
    }, 1500);
  };

  return (
    <main className="p-5 h-screen flex justify-center items-center">
      <div className="p-6 max-w-xl w-full rounded-2xl border shadow-sm">
        <form
          onSubmit={handleSubmit}
          className="px-4 flex items-center gap-4 rounded-lg border"
        >
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="네이버 블로그 포스팅 URL을 입력해주세요."
            className="flex-1  py-3 outline-none"
          />
          <button
            type="submit"
            disabled={inputUrl.length === 0}
            className={`shrink-0 h-full
              disabled:cursor-not-allowed disabled:opacity-30
              ${inputUrl.length > 0 ? 'cursor-pointer' : ''}
              `}
          >
            Search
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-2">
          <CopyToClipboard
            text={title}
            onCopy={() => {
              console.log('O');
            }}
          >
            <p className="font-medium cursor-pointer">
              {loading ? '제목 불러오는 중...' : title}
            </p>
          </CopyToClipboard>

          {submittedUrl && !error && (
            <CopyToClipboard
              text={submittedUrl}
              onCopy={() => {
                console.log('O');
              }}
            >
              <p className="break-all text-gray-600 cursor-pointer">
                {submittedUrl}
              </p>
            </CopyToClipboard>
          )}

          {error && <p className="text-red-500">{error}</p>}
        </div>

        {imageCount > 0 && (
          <button
            onClick={handleDownload}
            disabled={!submittedUrl || loading || !!error || downloading}
            className={`mt-4 px-4 py-2 rounded-lg bg-black text-white cursor-pointer
            disabled:cursor-not-allowed disabled:opacity-50
            `}
          >
            {downloading
              ? '압축 파일 생성 중...'
              : `이미지 ${imageCount}장 다운로드`}
          </button>
        )}
      </div>
    </main>
  );
}
