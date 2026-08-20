import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

interface AtsCheck { key: string; label: string; ok: boolean; hint: string }
interface AtsResult {
  score: number;
  coverage: number;
  matched: string[];
  missing: string[];
  checks: AtsCheck[];
  keywordCount: number;
  resumeWordCount: number;
  jobTitle: string | null;
}

interface PickedFile { uri: string; name: string; mime: string }

// Prefill payload handed over by the Jobs screen's "Check my fit" button.
interface AtsPrefill { jobTitle?: string; jobDescription?: string }

export default function AtsScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const [resume, setResume] = useState<PickedFile | null>(null);
  const [jd, setJd] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AtsResult | null>(null);

  // Pull a JD handed over from a job's "Check my fit" whenever this tab focuses.
  useFocusEffect(
    useCallback(() => {
      const pre = qc.getQueryData<AtsPrefill | null>(['atsPrefill']);
      if (pre) {
        if (pre.jobDescription) setJd(pre.jobDescription);
        setTitle(pre.jobTitle ?? '');
        setResult(null);
        setStatus('idle');
        qc.setQueryData(['atsPrefill'], null); // consume it
      }
    }, [qc]),
  );

  async function pickResume() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
      if (r.canceled) return;
      const f = r.assets[0];
      if (!f) return;
      if (f.size && f.size > 10 * 1024 * 1024) {
        setError('Resume must be under 10MB.');
        return;
      }
      const mime = f.mimeType ?? (f.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      setResume({ uri: f.uri, name: f.name ?? 'resume', mime });
      setError(null);
    } catch {
      setError('Could not open that file. Try another.');
    }
  }

  async function review() {
    if (!resume) { setError('Pick your resume first.'); return; }
    if (jd.trim().length < 40) { setError('Paste a fuller job description (a sentence or two).'); return; }
    setStatus('loading');
    setError(null);
    setResult(null);
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append('file', { uri: resume.uri, name: resume.name, type: resume.mime } as unknown as Blob);
      fd.append('jobDescription', jd.trim());
      if (title.trim()) fd.append('jobTitle', title.trim());

      const res = await fetch(`${API_URL}/ats/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { message?: string })?.message ?? 'Review failed. Try again.');
        setStatus('error');
        return;
      }
      setResult(data as AtsResult);
      setStatus('done');
    } catch {
      setError('Something went wrong. Check your connection and try again.');
      setStatus('error');
    }
  }

  const verdict = (score: number) =>
    score >= 75 ? { label: 'Strong match', color: c.success }
      : score >= 50 ? { label: 'Decent — a few fixes', color: c.warning }
        : { label: 'Needs work', color: c.danger };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Check how well your resume matches a job before you apply. Runs entirely on your resume text —
          no AI, nothing stored.
        </Text>

        {/* Resume picker */}
        <TouchableOpacity style={styles.pickCard} onPress={pickResume} activeOpacity={0.8}>
          <Text style={styles.pickIcon}>{resume ? '📄' : '📎'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickTitle}>{resume ? resume.name : 'Pick your resume'}</Text>
            <Text style={styles.pickSub}>{resume ? 'Tap to choose a different file' : 'PDF or image (photo/scan)'}</Text>
          </View>
          {resume && <Text style={styles.pickChange}>Change</Text>}
        </TouchableOpacity>

        {/* Job description */}
        {title ? <Text style={styles.forLabel}>🎯 For: <Text style={styles.forTitle}>{title}</Text></Text> : null}
        <TextInput
          style={styles.jd}
          placeholder="Paste the job description here…"
          placeholderTextColor={c.textFaint}
          value={jd}
          onChangeText={setJd}
          multiline
          textAlignVertical="top"
        />

        <TouchableOpacity style={[styles.reviewBtn, status === 'loading' && { opacity: 0.6 }]} onPress={review} disabled={status === 'loading'} activeOpacity={0.85}>
          {status === 'loading'
            ? <ActivityIndicator color={c.onColor} />
            : <Text style={styles.reviewBtnText}>{result ? 'Review again' : 'Review my resume'}</Text>}
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Result */}
        {result && status === 'done' && (() => {
          const v = verdict(result.score);
          const shownMissing = result.missing.slice(0, 14);
          return (
            <View style={styles.result}>
              <View style={styles.scoreRow}>
                <View style={[styles.scoreCircle, { borderColor: v.color }]}>
                  <Text style={[styles.scoreNum, { color: v.color }]}>{result.score}</Text>
                  <Text style={styles.scoreOf}>/100</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.verdict, { color: v.color }]}>{v.label}</Text>
                  <Text style={styles.coverage}>{result.coverage}% of the job's key terms are in your resume</Text>
                </View>
              </View>

              {result.matched.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>✅ Matched keywords</Text>
                  <View style={styles.chips}>
                    {result.matched.map(k => (
                      <View key={k} style={[styles.kw, { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)' }]}>
                        <Text style={[styles.kwText, { color: c.successDeep }]}>{k}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {shownMissing.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>⚠️ Missing — add these if they're true for you</Text>
                  <View style={styles.chips}>
                    {shownMissing.map(k => (
                      <View key={k} style={[styles.kw, { backgroundColor: c.chipBg, borderColor: c.chipBorder }]}>
                        <Text style={[styles.kwText, { color: c.textMuted }]}>{k}</Text>
                      </View>
                    ))}
                  </View>
                  {result.missing.length > shownMissing.length && (
                    <Text style={styles.moreMissing}>+{result.missing.length - shownMissing.length} more</Text>
                  )}
                </>
              )}

              <Text style={styles.sectionLabel}>📋 Resume checks</Text>
              {result.checks.map(chk => (
                <View key={chk.key} style={styles.checkRow}>
                  <Text style={styles.checkIcon}>{chk.ok ? '✅' : '❌'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.checkLabel, { color: chk.ok ? c.text : c.text }]}>{chk.label}</Text>
                    {!chk.ok && <Text style={styles.checkHint}>{chk.hint}</Text>}
                  </View>
                </View>
              ))}

              <Text style={styles.disclaimer}>
                A guide, not a guarantee — every ATS scores differently. Only add skills you genuinely have.
              </Text>
            </View>
          );
        })()}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 13, color: c.textMuted, lineHeight: 19 },

  pickCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  pickIcon: { fontSize: 22 },
  pickTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  pickSub: { fontSize: 12, color: c.textFaint, marginTop: 2 },
  pickChange: { fontSize: 12, fontWeight: '700', color: c.primary },

  forLabel: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  forTitle: { fontWeight: '700', color: c.text },
  jd: {
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    padding: 12, fontSize: 14, color: c.text, minHeight: 130,
  },

  reviewBtn: { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  reviewBtnText: { color: c.onColor, fontSize: 15, fontWeight: '800' },
  error: { color: c.danger, fontSize: 13, textAlign: 'center' },

  result: { gap: 10, marginTop: 4 },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder,
  },
  scoreCircle: {
    width: 82, height: 82, borderRadius: 41, borderWidth: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreNum: { fontSize: 28, fontWeight: '800' },
  scoreOf: { fontSize: 11, color: c.textFaint, marginTop: -2 },
  verdict: { fontSize: 18, fontWeight: '800' },
  coverage: { fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 17 },

  sectionLabel: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kw: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  kwText: { fontSize: 12, fontWeight: '600' },
  moreMissing: { fontSize: 12, color: c.textFaint },

  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.cardBorder },
  checkIcon: { fontSize: 15, marginTop: 1 },
  checkLabel: { fontSize: 13.5, fontWeight: '600' },
  checkHint: { fontSize: 12, color: c.textMuted, marginTop: 3, lineHeight: 17 },

  disclaimer: { fontSize: 11, color: c.textFaint, marginTop: 8, lineHeight: 16, fontStyle: 'italic' },
});
