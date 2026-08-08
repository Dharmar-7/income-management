import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, PermissionsAndroid,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppAlert from '@/components/AppAlert';
import StatementReviewSheet, { type ParsedRow, type CommitRow } from '@/components/StatementReviewSheet';
import { useTheme } from '@/context/ThemeContext';

const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';
type SmsSyncStatus = 'idle' | 'requesting' | 'reading' | 'syncing' | 'done' | 'error';

interface ImportResult {
  message: string;
  imported: number;
  skipped: number;
  failed: number;
}

interface AtmEntry {
  amount: number;
  date: string;
  rawSms: string;
}

interface SmsSyncResult {
  imported: number;
  skipped: number;
  failed: number;
  atmTransactions: AtmEntry[];
}

export default function ImportScreen() {
  const { theme: c } = useTheme();
  const { getToken } = useAuth();

  // ── Import state ─────────────────────────────────────────────────────────
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // ── Bank statement (PDF/photo) state ───────────────────────────────────────
  const [stmtStatus, setStmtStatus] = useState<'idle' | 'parsing' | 'review' | 'committing' | 'success' | 'error'>('idle');
  const [stmtRows, setStmtRows] = useState<ParsedRow[]>([]);
  const [stmtCats, setStmtCats] = useState<{ id: string; name: string; icon: string }[]>([]);
  const [stmtResult, setStmtResult] = useState<ImportResult | null>(null);
  const [stmtError, setStmtError] = useState<string | null>(null);

  // ── SMS sync state ────────────────────────────────────────────────────────
  const [smsStatus, setSmsStatus] = useState<SmsSyncStatus>('idle');
  const [smsResult, setSmsResult] = useState<SmsSyncResult | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);

  // ── Simple info alert ─────────────────────────────────────────────────────
  const [alertData, setAlertData] = useState<{ title: string; message: string } | null>(null);

  // ── ATM withdrawal queue ──────────────────────────────────────────────────
  const [atmList, setAtmList] = useState<AtmEntry[]>([]);
  const [atmIdx, setAtmIdx] = useState(0);
  const [atmToken, setAtmToken] = useState('');

  const atmEntry = atmList.length > 0 && atmIdx < atmList.length ? atmList[atmIdx] : null;

  async function addAtmCash(atm: AtmEntry) {
    try {
      await fetch(`${API_URL}/cash/add`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${atmToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: atm.amount, source: 'ATM', date: atm.date, note: 'ATM withdrawal (from SMS)' }),
      });
    } catch { /* silent — user can add manually */ }
  }

  async function handleSmsSync() {
    if (Platform.OS !== 'android') {
      setAlertData({ title: 'Android Only', message: 'SMS reading is only available on Android devices.' });
      return;
    }

    if (IS_EXPO_GO) {
      setAlertData({
        title: 'Development Build Required',
        message: 'SMS reading uses a native Android library that cannot run inside Expo Go.\n\nTo use this feature, install the development build of the app (.apk) on your device.',
      });
      return;
    }

    setSmsStatus('requesting');
    setSmsError(null);
    setSmsResult(null);

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'Read SMS Permission',
        message: 'Income Manager needs to read your bank SMS to import transactions automatically.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );

    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      setSmsStatus('error');
      setSmsError('SMS permission denied. Go to Settings → Apps → Income Manager → Permissions to enable it.');
      return;
    }

    try {
      const token = await getToken();

      setSmsStatus('reading');
      const lastSyncRes = await fetch(`${API_URL}/sms/last-sync`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { sinceMs } = await lastSyncRes.json();

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SmsAndroid = require('react-native-get-sms-android').default;
      const rawMessages: Array<{ body: string; date: number; address: string }> =
        await new Promise((resolve, reject) => {
          SmsAndroid.list(
            JSON.stringify({ box: 'inbox', minDate: sinceMs, maxCount: 2000 }),
            (error: string) => reject(new Error(error)),
            (_count: number, smsList: string) => resolve(JSON.parse(smsList)),
          );
        });

      if (rawMessages.length === 0) {
        setSmsResult({ imported: 0, skipped: 0, failed: 0, atmTransactions: [] });
        setSmsStatus('done');
        return;
      }

      setSmsStatus('syncing');
      const syncRes = await fetch(`${API_URL}/sms/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: rawMessages.map(m => ({ body: m.body, date: m.date, address: m.address })),
        }),
      });

      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({ message: 'Sync failed' }));
        throw new Error(err.message ?? 'Sync failed');
      }

      const result: SmsSyncResult = await syncRes.json();
      setSmsResult(result);
      setSmsStatus('done');

      if (result.atmTransactions.length > 0 && token) {
        setAtmList(result.atmTransactions);
        setAtmIdx(0);
        setAtmToken(token!);
      }
    } catch (err) {
      setSmsStatus('error');
      setSmsError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file) return;

      if (file.size && file.size > 50 * 1024 * 1024) {
        setImportError('File is too large. Maximum size is 50MB.');
        setImportStatus('error');
        return;
      }

      setImportStatus('uploading');
      setImportError(null);
      setImportResult(null);

      const token = await getToken();
      const formData = new FormData();
      formData.append('file', { uri: file.uri, name: file.name, type: 'application/json' } as unknown as Blob);

      const res = await fetch(`${API_URL}/import/takeout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error(err.message ?? 'Upload failed');
      }

      const data: ImportResult = await res.json();
      setImportResult(data);
      setImportStatus('success');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Something went wrong.');
      setImportStatus('error');
    }
  }

  // ── Bank statement: pick → parse → review ──────────────────────────────────
  async function handlePickStatement() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!file) return;

      if (file.size && file.size > 15 * 1024 * 1024) {
        setStmtError('File is too large. Maximum size is 15MB.');
        setStmtStatus('error');
        return;
      }

      setStmtStatus('parsing');
      setStmtError(null);
      setStmtResult(null);

      const token = await getToken();
      const mime =
        file.mimeType ??
        (file.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

      const formData = new FormData();
      formData.append('file', { uri: file.uri, name: file.name ?? 'statement', type: mime } as unknown as Blob);

      // Parse the statement and load categories (for the review picker) together.
      const [parseRes, catsRes] = await Promise.all([
        fetch(`${API_URL}/import/statement/parse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }),
        fetch(`${API_URL}/transactions/categories`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({ message: 'Could not read the statement.' }));
        throw new Error(err.message ?? 'Could not read the statement.');
      }

      const data: { transactions: ParsedRow[] } = await parseRes.json();
      const cats = catsRes.ok ? await catsRes.json() : [];
      setStmtRows(data.transactions ?? []);
      setStmtCats(cats);
      setStmtStatus('review');
    } catch (err) {
      setStmtError(err instanceof Error ? err.message : 'Something went wrong.');
      setStmtStatus('error');
    }
  }

  // ── Bank statement: commit the reviewed rows ───────────────────────────────
  async function handleCommitStatement(chosen: CommitRow[], bankId: string | null) {
    try {
      setStmtStatus('committing');
      const token = await getToken();
      const res = await fetch(`${API_URL}/import/statement/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: chosen, bankId: bankId || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Import failed' }));
        throw new Error(err.message ?? 'Import failed');
      }
      const result: ImportResult = await res.json();
      setStmtResult(result);
      setStmtStatus('success');
    } catch (err) {
      setStmtError(err instanceof Error ? err.message : 'Something went wrong.');
      setStmtStatus('error');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom']}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>

        {/* ── Google Takeout ──────────────────────────────────────────── */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: c.textFaint, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 }}>
          IMPORT FROM GOOGLE PAY
        </Text>

        <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Text style={{ fontSize: 28 }}>📂</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: c.text, fontSize: 15 }}>Google Takeout</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>Upload your Google Pay transaction history as JSON</Text>
            </View>
          </View>

          <View style={{ backgroundColor: c.inputBg, borderRadius: 12, padding: 12, marginBottom: 16 }}>
            <Text style={{ fontWeight: '600', color: c.text, fontSize: 12, marginBottom: 8 }}>How to export your Google Pay history</Text>
            {[
              'Go to takeout.google.com',
              'Tap "Deselect all", then select Google Pay',
              'Tap "Next step" → "Create export"',
              'Download the ZIP file from your email',
              'Extract and find the .json file inside',
              'Upload it below',
            ].map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                <Text style={{ color: c.primary, fontSize: 12, fontWeight: '700', width: 16 }}>{i + 1}.</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, flex: 1 }}>{step}</Text>
              </View>
            ))}
          </View>

          {importStatus === 'idle' && (
            <TouchableOpacity
              onPress={handlePickFile}
              style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.primary, borderRadius: 12, paddingVertical: 20, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 28, marginBottom: 6 }}>📁</Text>
              <Text style={{ fontWeight: '600', color: c.primary, fontSize: 14 }}>Tap to select JSON file</Text>
            </TouchableOpacity>
          )}

          {importStatus === 'uploading' && (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={c.primary} size="large" />
              <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 12 }}>Importing transactions…</Text>
            </View>
          )}

          {importStatus === 'success' && importResult && (
            <View>
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 36, marginBottom: 6 }}>✅</Text>
                <Text style={{ fontWeight: '800', color: c.text, fontSize: 16 }}>Import Complete!</Text>
                <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4 }}>{importResult.message}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <StatBadge value={importResult.imported} label="Imported" bg="#dcfce7" text="#15803d" />
                <StatBadge value={importResult.skipped} label="Existed" bg="#fef9c3" text="#a16207" />
                <StatBadge value={importResult.failed} label="Failed" bg="#fee2e2" text="#b91c1c" />
              </View>
              <TouchableOpacity
                onPress={() => { setImportStatus('idle'); setImportResult(null); }}
                style={{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: 100, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Import Another File</Text>
              </TouchableOpacity>
            </View>
          )}

          {importStatus === 'error' && (
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>❌</Text>
              <Text style={{ color: c.danger, fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{importError}</Text>
              <TouchableOpacity
                onPress={() => { setImportStatus('idle'); setImportError(null); }}
                style={{ backgroundColor: c.primary, borderRadius: 100, paddingHorizontal: 24, paddingVertical: 10 }}
              >
                <Text style={{ color: c.onColor, fontWeight: '600' }}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Bank Statement (PDF / Photo) ────────────────────────────── */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: c.textFaint, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 }}>
          BANK STATEMENT (PDF / PHOTO)
        </Text>

        <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Text style={{ fontSize: 28 }}>🧾</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: c.text, fontSize: 15 }}>Import Statement</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>Upload a bank statement PDF, or a photo/screenshot</Text>
            </View>
          </View>

          <View style={{ backgroundColor: c.inputBg, borderRadius: 12, padding: 12, marginBottom: 16, gap: 4 }}>
            <Text style={{ fontSize: 12, color: c.textMuted }}>📄 Text PDFs are read directly</Text>
            <Text style={{ fontSize: 12, color: c.textMuted }}>📷 Photos/screenshots are read on-server (free OCR)</Text>
            <Text style={{ fontSize: 12, color: c.textMuted }}>✅ You review &amp; fix rows before anything is saved</Text>
          </View>

          {stmtStatus === 'idle' && (
            <TouchableOpacity
              onPress={handlePickStatement}
              style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.primary, borderRadius: 12, paddingVertical: 20, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 28, marginBottom: 6 }}>🧾</Text>
              <Text style={{ fontWeight: '600', color: c.primary, fontSize: 14 }}>Tap to select PDF or photo</Text>
            </TouchableOpacity>
          )}

          {stmtStatus === 'parsing' && (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={c.primary} size="large" />
              <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 12, textAlign: 'center' }}>
                Reading your statement…{'\n'}Photos can take a few seconds.
              </Text>
            </View>
          )}

          {(stmtStatus === 'review' || stmtStatus === 'committing') && (
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <Text style={{ color: c.textMuted, fontSize: 13 }}>Review open…</Text>
            </View>
          )}

          {stmtStatus === 'success' && stmtResult && (
            <View>
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 36, marginBottom: 6 }}>✅</Text>
                <Text style={{ fontWeight: '800', color: c.text, fontSize: 16 }}>Import Complete!</Text>
                <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4 }}>{stmtResult.message}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <StatBadge value={stmtResult.imported} label="Imported" bg="#dcfce7" text="#15803d" />
                <StatBadge value={stmtResult.skipped} label="Existed" bg="#fef9c3" text="#a16207" />
                <StatBadge value={stmtResult.failed} label="Failed" bg="#fee2e2" text="#b91c1c" />
              </View>
              <TouchableOpacity
                onPress={() => { setStmtStatus('idle'); setStmtResult(null); setStmtRows([]); }}
                style={{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: 100, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Import Another Statement</Text>
              </TouchableOpacity>
            </View>
          )}

          {stmtStatus === 'error' && (
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>❌</Text>
              <Text style={{ color: c.danger, fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{stmtError}</Text>
              <TouchableOpacity
                onPress={() => { setStmtStatus('idle'); setStmtError(null); }}
                style={{ backgroundColor: c.primary, borderRadius: 100, paddingHorizontal: 24, paddingVertical: 10 }}
              >
                <Text style={{ color: c.onColor, fontWeight: '600' }}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Bank SMS Sync ───────────────────────────────────────────── */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: c.textFaint, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 }}>
          BANK SMS SYNC
        </Text>

        <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Text style={{ fontSize: 28 }}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: c.text, fontSize: 15 }}>Bank SMS Import</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>Import IOB, TMB and other bank transactions from SMS</Text>
            </View>
            {Platform.OS !== 'android' && (
              <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 }}>
                <Text style={{ fontSize: 10, color: '#92400e', fontWeight: '700' }}>ANDROID</Text>
              </View>
            )}
          </View>

          {Platform.OS !== 'android' ? (
            <View style={{ backgroundColor: '#fef9c3', borderRadius: 12, padding: 12 }}>
              <Text style={{ fontSize: 12, color: '#92400e', textAlign: 'center' }}>
                SMS reading is only available on Android devices.
              </Text>
            </View>
          ) : (
            <>
              {IS_EXPO_GO && (
                <View style={{ backgroundColor: '#fef3c7', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fcd34d' }}>
                  <Text style={{ fontWeight: '700', color: '#92400e', fontSize: 13, marginBottom: 4 }}>Requires Development Build</Text>
                  <Text style={{ color: '#92400e', fontSize: 12, lineHeight: 18 }}>
                    You're running in Expo Go. SMS sync uses a native library that isn't available here.
                    Install the dev build (.apk) on your device to use this feature.
                  </Text>
                </View>
              )}

              <View style={{ backgroundColor: c.inputBg, borderRadius: 12, padding: 12, marginBottom: 16, gap: 4 }}>
                <Text style={{ fontSize: 12, color: c.textMuted }}>📩 Reads bank SMS from your inbox</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>🔄 Skips transactions already imported</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>🏧 Prompts to add ATM cash to Cash in Hand</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>📅 Only reads SMS since your last sync</Text>
              </View>

              {smsStatus === 'idle' && (
                <TouchableOpacity
                  onPress={handleSmsSync}
                  style={{ backgroundColor: c.orange, borderRadius: 100, paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: c.onColor, fontWeight: '700', fontSize: 14 }}>Sync Bank SMS</Text>
                </TouchableOpacity>
              )}

              {(smsStatus === 'requesting' || smsStatus === 'reading' || smsStatus === 'syncing') && (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <ActivityIndicator color={c.orange} size="large" />
                  <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 12 }}>
                    {smsStatus === 'requesting' && 'Requesting permission…'}
                    {smsStatus === 'reading' && 'Reading SMS inbox…'}
                    {smsStatus === 'syncing' && 'Importing transactions…'}
                  </Text>
                </View>
              )}

              {smsStatus === 'done' && smsResult && (
                <View>
                  <View style={{ alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ fontSize: 36, marginBottom: 6 }}>✅</Text>
                    <Text style={{ fontWeight: '800', color: c.text, fontSize: 16 }}>Sync Complete!</Text>
                    {smsResult.atmTransactions.length > 0 && (
                      <Text style={{ color: c.orange, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                        {smsResult.atmTransactions.length} ATM withdrawal{smsResult.atmTransactions.length > 1 ? 's' : ''} detected
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                    <StatBadge value={smsResult.imported} label="Imported" bg="#dcfce7" text="#15803d" />
                    <StatBadge value={smsResult.skipped} label="Existed" bg="#fef9c3" text="#a16207" />
                    <StatBadge value={smsResult.failed} label="Failed" bg="#fee2e2" text="#b91c1c" />
                  </View>
                  <TouchableOpacity
                    onPress={() => { setSmsStatus('idle'); setSmsResult(null); }}
                    style={{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: 100, paddingVertical: 12, alignItems: 'center' }}
                  >
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Sync Again</Text>
                  </TouchableOpacity>
                </View>
              )}

              {smsStatus === 'error' && (
                <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>⚠️</Text>
                  <Text style={{ color: c.danger, fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{smsError}</Text>
                  <TouchableOpacity
                    onPress={() => { setSmsStatus('idle'); setSmsError(null); }}
                    style={{ backgroundColor: c.orange, borderRadius: 100, paddingHorizontal: 24, paddingVertical: 10 }}
                  >
                    <Text style={{ color: c.onColor, fontWeight: '600' }}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

      </ScrollView>

      {/* Statement review — pick which parsed rows to import */}
      <StatementReviewSheet
        visible={stmtStatus === 'review' || stmtStatus === 'committing'}
        rows={stmtRows}
        categories={stmtCats}
        committing={stmtStatus === 'committing'}
        onClose={() => { setStmtStatus('idle'); setStmtRows([]); }}
        onConfirm={handleCommitStatement}
      />

      {/* Info alert (Android Only / Expo Go guard) */}
      <AppAlert
        visible={!!alertData}
        title={alertData?.title ?? ''}
        message={alertData?.message ?? ''}
        onClose={() => setAlertData(null)}
      />

      {/* ATM withdrawal prompts — shown one at a time after SMS sync */}
      {atmEntry && (
        <AppAlert
          visible
          icon="🏧"
          title="ATM Withdrawal Detected"
          message={`You withdrew ₹${atmEntry.amount.toLocaleString('en-IN')} on ${new Date(atmEntry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.\nAdd this to Cash in Hand?`}
          confirmLabel="Add Cash"
          onClose={() => setAtmIdx(i => i + 1)}
          onConfirm={() => addAtmCash(atmEntry)}
        />
      )}
    </SafeAreaView>
  );
}

function StatBadge({ value, label, bg, text }: { value: number; label: string; bg: string; text: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: bg, borderRadius: 12, padding: 12, alignItems: 'center' }}>
      <Text style={{ fontWeight: '800', fontSize: 20, color: text }}>{value}</Text>
      <Text style={{ fontSize: 11, color: text, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
