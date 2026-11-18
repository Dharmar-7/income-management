import { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/Skeleton';
import { useArticle, useReaderBack, readingMinutes } from '@/lib/newsReader';

// In-app reader: the full article as clean text, no ads or pop-ups.
export default function NewsReadScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const params = useLocalSearchParams<{ url?: string; title?: string; source?: string; summary?: string; from?: string }>();
  const url = typeof params.url === 'string' ? params.url : undefined;
  const goBack = useReaderBack(params.from);
  const q = useArticle(url);
  const a = q.data;

  const title = a?.title || params.title || '';
  const source = a?.siteName || params.source || (url ? hostOf(url) : '');
  const date = a?.published ? new Date(a.published).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  async function openOriginal() {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(a?.url ?? url, {
        toolbarColor: c.card,
        controlsColor: c.primary,
        enableBarCollapsing: true,
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch { /* malformed link */ }
  }

  async function share() {
    try { await Share.share({ message: `${title}\n${a?.url ?? url ?? ''}` }); } catch { /* dismissed */ }
  }

  const errorText = q.error instanceof ApiError ? q.error.message : 'Couldn’t load this article.';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <TouchableOpacity onPress={share} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.topAction}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openOriginal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.topAction}>Original ↗</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* key: a new article starts scrolled to the top */}
      <ScrollView key={url} contentContainerStyle={styles.content}>
        <Text style={styles.meta}>
          {[source, date, a ? `${readingMinutes(a.wordCount)} min read` : null].filter(Boolean).join(' · ')}
        </Text>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {a?.byline ? <Text style={styles.byline}>{a.byline}</Text> : null}

        {a?.image ? <Image source={{ uri: a.image }} style={styles.image} resizeMode="cover" /> : null}

        {q.isLoading && (
          <View style={{ gap: 10, marginTop: 8 }}>
            {[100, 96, 100, 88, 100, 92, 70].map((w, i) => <Skeleton key={i} width={`${w}%`} height={14} />)}
          </View>
        )}

        {q.isError && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{errorText}</Text>
            {params.summary ? <Text style={styles.para}>{params.summary}</Text> : null}
            <TouchableOpacity style={styles.btn} onPress={openOriginal}>
              <Text style={styles.btnText}>Read on {source || 'the website'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => q.refetch()} style={{ alignSelf: 'center', marginTop: 10 }}>
              <Text style={styles.topAction}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {a?.blocks.map((b, i) => {
          if (b.type === 'h') return <Text key={i} style={styles.heading}>{b.text}</Text>;
          if (b.type === 'li') return <Text key={i} style={styles.para}>•  {b.text}</Text>;
          if (b.type === 'quote') return <Text key={i} style={[styles.para, styles.quote]}>{b.text}</Text>;
          return <Text key={i} style={styles.para} selectable>{b.text}</Text>;
        })}

        {a?.partial && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Only part of this story could be loaded</Text>
            <Text style={styles.noticeText}>
              The site may need a subscription or limit reading in apps. Open the original to read it all.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={openOriginal}>
              <Text style={styles.btnText}>Read on {source || 'the website'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {a && !a.partial && (
          <TouchableOpacity onPress={openOriginal} style={{ marginTop: 18, alignSelf: 'center' }}>
            <Text style={styles.footerLink}>View original on {source || 'the website'} ↗</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder,
  },
  back: { fontSize: 15, fontWeight: '700', color: c.primary },
  topAction: { fontSize: 13, fontWeight: '600', color: c.primary },
  content: { padding: 18, paddingBottom: 48 },
  meta: { fontSize: 12, color: c.textFaint, marginBottom: 8 },
  title: { fontSize: 23, lineHeight: 30, fontWeight: '800', color: c.text },
  byline: { fontSize: 13, color: c.textMuted, marginTop: 8 },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, marginTop: 14, backgroundColor: c.card },
  heading: { fontSize: 18, lineHeight: 25, fontWeight: '700', color: c.text, marginTop: 18 },
  para: { fontSize: 16, lineHeight: 26, color: c.text, marginTop: 14 },
  quote: { fontStyle: 'italic', color: c.textMuted, borderLeftWidth: 3, borderLeftColor: c.primary, paddingLeft: 12 },
  notice: {
    marginTop: 20, padding: 14, borderRadius: 14,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
  },
  noticeTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  noticeText: { fontSize: 13, lineHeight: 19, color: c.textMuted, marginTop: 6 },
  btn: { marginTop: 14, backgroundColor: c.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: c.onColor, fontSize: 14, fontWeight: '700' },
  footerLink: { fontSize: 13, color: c.textMuted },
});
