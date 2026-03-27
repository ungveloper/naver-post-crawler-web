'use client';

import { SubmitEvent, useEffect, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';

function getFilenameFromContentDisposition(value: string | null) {
  if (!value) return null;

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // ignore
    }
  }

  const asciiMatch = value.match(/filename="?([^"]+)"?/i);
  return asciiMatch?.[1] || null;
}

async function downloadByFetch(url: string, fallbackFileName: string) {
  const res = await fetch(url, {
    cache: 'no-store',
  });

  if (!res.ok) {
    const message = await res.text().catch(() => '');
    throw new Error(message || '다운로드에 실패했습니다.');
  }

  const blob = await res.blob();
  const fileName =
    getFilenameFromContentDisposition(res.headers.get('content-disposition')) ||
    fallbackFileName;

  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 1000);
}

export default function Home() {
  const [inputUrl, setInputUrl] = useState<string>('');
  const [submittedUrl, setSubmittedUrl] = useState<string>('');
  const [title, setTitle] = useState<string>('블로그 URL을 입력해 주세요.');
  const [imageCount, setImageCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);
  const [textDownloading, setTextDownloading] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;

    const fetchPostInfo = async () => {
      if (!submittedUrl) return;

      try {
        setLoading(true);
        setError('');
        setActionError('');
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
      setActionError('');
      setSubmittedUrl('');
      setTitle('블로그 URL을 입력해 주세요.');
      setImageCount(0);
      return;
    }

    try {
      const url = new URL(trimmed);

      if (
        url.hostname !== 'blog.naver.com' &&
        url.hostname !== 'm.blog.naver.com'
      ) {
        throw new Error('네이버 블로그 URL만 입력할 수 있습니다.');
      }

      if (url.hostname === 'm.blog.naver.com') {
        url.hostname = 'blog.naver.com';
      }

      setError('');
      setActionError('');
      setSubmittedUrl(url.toString());
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '올바른 URL 형식이 아닙니다.',
      );
      setActionError('');
      setSubmittedUrl('');
      setTitle('올바른 URL을 입력해 주세요.');
      setImageCount(0);
    }
  };

  const handleDownload = async () => {
    if (!submittedUrl || downloading) return;

    try {
      setDownloading(true);
      setActionError('');

      await downloadByFetch(
        `/api/naver-blog/download?url=${encodeURIComponent(submittedUrl)}`,
        'naver-blog-images.zip',
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : '이미지 다운로드에 실패했습니다.',
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleTextDownload = async () => {
    if (!submittedUrl || textDownloading) return;

    try {
      setTextDownloading(true);
      setActionError('');

      await downloadByFetch(
        `/api/naver-blog/text?url=${encodeURIComponent(submittedUrl)}`,
        'naver-blog-article.txt',
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : '텍스트 다운로드에 실패했습니다.',
      );
    } finally {
      setTextDownloading(false);
    }
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
            className="flex-1 py-3 outline-none"
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
          {actionError && <p className="text-red-500">{actionError}</p>}
        </div>

        {submittedUrl && !error && (
          <div className="mt-4 flex flex-col gap-2">
            {imageCount > 0 && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={!submittedUrl || loading || !!error || downloading}
                className="px-4 py-2 rounded-lg bg-black text-white cursor-pointer
                disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloading
                  ? '이미지 다운로드 준비 중...'
                  : `이미지 ${imageCount}장 다운로드`}
              </button>
            )}

            <button
              type="button"
              onClick={handleTextDownload}
              disabled={!submittedUrl || loading || !!error || textDownloading}
              className="px-4 py-2 rounded-lg border cursor-pointer
              disabled:cursor-not-allowed disabled:opacity-50"
            >
              {textDownloading
                ? 'TXT 다운로드 준비 중...'
                : '아티클 본문 TXT 다운로드'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
