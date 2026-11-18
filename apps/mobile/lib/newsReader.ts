import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from './api';

// Reader view: the backend fetches the article page and returns clean text
// blocks (GET /news/article), which the app renders natively.

export type ArticleBlockType = 'p' | 'h' | 'li' | 'quote';
export interface Article {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  published: string | null;
  image: string | null;
  blocks: { type: ArticleBlockType; text: string }[];
  wordCount: number;
  partial: boolean; // only a teaser came back (paywall / site blocks apps)
}

export interface ReaderParams {
  url: string;
  title?: string;
  source?: string;
  summary?: string;
  from?: 'news' | 'saved' | 'watchlist';
}

// Route for opening an article in the reader, from anywhere in the app.
export function readerHref(p: ReaderParams): Href {
  const params: Record<string, string> = { url: p.url };
  if (p.title) params.title = p.title;
  if (p.source) params.source = p.source;
  // Keep the URL small: the summary is just a fallback if the reader fails.
  if (p.summary) params.summary = p.summary.slice(0, 400);
  if (p.from) params.from = p.from;
  return { pathname: '/news-read', params };
}

// Deep link used by the Headlines home-screen widget.
export function readerDeepLink(p: { url: string; title?: string; source?: string }): string {
  const qs = new URLSearchParams({ url: p.url, ...(p.title && { title: p.title }), ...(p.source && { source: p.source }) });
  return `velora://news-read?${qs.toString()}`;
}

export function useArticle(url: string | undefined) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['article', url],
    enabled: !!url,
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Article>(`/news/article?url=${encodeURIComponent(url!)}`, token!);
    },
    staleTime: 6 * 60 * 60 * 1000, // articles rarely change; the server caches too
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}

// Tabs' default "back" jumps to Home; the reader returns to where it came from.
// The hardware-back handler is active only while the reader is focused (tab
// screens stay mounted, so a plain effect would hijack back everywhere).
export function useReaderBack(from: string | undefined) {
  const router = useRouter();
  const target: Href = from === 'saved' ? '/saved' : from === 'watchlist' ? '/watchlist' : '/news';
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.navigate(target);
        return true;
      });
      return () => sub.remove();
    }, [router, target]),
  );
  return () => router.navigate(target);
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200));
}
