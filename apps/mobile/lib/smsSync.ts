// Bank SMS → transactions. Shared by the Import screen's "Sync Bank SMS" button
// and the silent auto-sync that runs when the app comes to the foreground.
//
// Privacy: only bank-looking SMS ever leave the phone. A native regex keeps
// just messages with a ₹/Rs/INR amount, then looksLikeBankSms() drops personal
// senders (phone numbers) and anything without a debit/credit word. The server
// does the real parsing and de-duplication.
import { Platform, PermissionsAndroid } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '@/lib/api';

export interface AtmEntry {
  amount: number;
  date: string;
  rawSms: string;
}

export interface SmsSyncResult {
  imported: number;
  skipped: number;
  failed: number;
  atmTransactions: AtmEntry[];
}

interface RawSms { body: string; date: number; address: string }

const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

// Where the next sync starts reading from. Kept on the device so a sync with
// nothing new makes no network call at all (no server/DB wake-up).
const LAST_SYNC_KEY = 'sms:lastSyncMs';
const LAST_AUTO_KEY = 'sms:lastAutoMs';
const AUTO_INTERVAL_MS = 15 * 60_000;   // at most one auto-sync per 15 min
const FIRST_SYNC_DAYS = 90;

// Java String.matches() — must match the whole body. (?s) lets . cross newlines.
const NATIVE_BODY_REGEX = '(?is).*(?:rs\\.?|inr|₹)\\s*[0-9].*';
const PHONE_SENDER_RE = /^\+?\d[\d\s-]{5,}$/;
const MONEY_VERB_RE = /debit|credit|withdraw|spent|paid|sent|received|deposit|refund|revers/i;

export function looksLikeBankSms(m: RawSms): boolean {
  return !PHONE_SENDER_RE.test((m.address ?? '').trim()) && MONEY_VERB_RE.test(m.body ?? '');
}

/** Android, real APK (not Expo Go). */
export function smsSupported(): boolean {
  return Platform.OS === 'android' && !IS_EXPO_GO;
}

export async function hasSmsPermission(): Promise<boolean> {
  if (!smsSupported()) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

export async function requestSmsPermission(): Promise<boolean> {
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: 'Read bank SMS',
    message: 'Velora reads your bank transaction SMS to add them automatically. Personal messages are never uploaded.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function readInbox(sinceMs: number): Promise<RawSms[]> {
  // The library does `module.exports = NativeModules.Sms` (CommonJS, no default export).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const smsModule = require('react-native-get-sms-android');
  const SmsAndroid = smsModule?.default ?? smsModule;
  if (!SmsAndroid?.list) {
    return Promise.reject(new Error('SMS reader is not available in this build. Please install the latest Velora APK.'));
  }
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({ box: 'inbox', minDate: sinceMs, bodyRegex: NATIVE_BODY_REGEX, maxCount: 3000 }),
      (error: string) => reject(new Error(error)),
      (_count: number, smsList: string) => resolve(JSON.parse(smsList)),
    );
  });
}

async function getSinceMs(token: string): Promise<number> {
  try {
    const local = await AsyncStorage.getItem(LAST_SYNC_KEY);
    if (local && Number(local) > 0) return Number(local);
  } catch { /* fall through to the server */ }
  try {
    const { sinceMs } = await apiFetch<{ sinceMs: number }>('/sms/last-sync', token);
    return sinceMs;
  } catch {
    return Date.now() - FIRST_SYNC_DAYS * 86_400_000;
  }
}

/**
 * Read new bank SMS and import them. Caller must already hold READ_SMS.
 * Returns the server's result (zeros when there was nothing new).
 */
export async function runSmsSync(getToken: () => Promise<string | null>): Promise<SmsSyncResult> {
  const token = await getToken();
  if (!token) throw new Error('Not signed in.');

  const sinceMs = await getSinceMs(token);
  const startedAt = Date.now();
  const candidates = (await readInbox(sinceMs)).filter(looksLikeBankSms);

  let result: SmsSyncResult = { imported: 0, skipped: 0, failed: 0, atmTransactions: [] };
  if (candidates.length > 0) {
    result = await apiFetch<SmsSyncResult>('/sms/sync', token, {
      method: 'POST',
      body: JSON.stringify({
        messages: candidates.map(m => ({ body: m.body, date: m.date, address: m.address })),
      }),
    });
  }
  // Next time, start from when this read began (an SMS landing mid-sync is
  // re-read and de-duplicated by the server rather than missed).
  try { await AsyncStorage.setItem(LAST_SYNC_KEY, String(startedAt)); } catch { /* best effort */ }
  return result;
}

/**
 * Silent foreground sync: only when supported, permission is already granted
 * (never prompts), and at most once per AUTO_INTERVAL_MS. Returns null when it
 * didn't run; never throws.
 */
export async function autoSmsSync(getToken: () => Promise<string | null>): Promise<SmsSyncResult | null> {
  try {
    if (!(await hasSmsPermission())) return null;
    const last = Number((await AsyncStorage.getItem(LAST_AUTO_KEY)) ?? 0);
    if (Date.now() - last < AUTO_INTERVAL_MS) return null;
    await AsyncStorage.setItem(LAST_AUTO_KEY, String(Date.now()));
    return await runSmsSync(getToken);
  } catch {
    return null;
  }
}
