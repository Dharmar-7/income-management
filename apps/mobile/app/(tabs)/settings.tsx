import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useClerk, useUser, useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useTheme, type ThemeMode } from '@/context/ThemeContext';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: '📱' },
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
];

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function SettingsScreen() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { theme: c, mode, setMode } = useTheme();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<{ monthStartDay?: number }>('/users/me', token!, { method: 'POST' });
    },
    staleTime: 5 * 60 * 1000,
  });
  const monthStartDay = meQuery.data?.monthStartDay ?? 1;

  async function setStartDay(day: number) {
    if (day === monthStartDay || saving) return;
    setSaving(true);
    try {
      const token = await getToken();
      await apiFetch('/users/me', token!, {
        method: 'PATCH',
        body: JSON.stringify({ monthStartDay: day }),
      });
      queryClient.setQueryData(['me'], (old: object | undefined) => ({ ...(old ?? {}), monthStartDay: day }));
      queryClient.invalidateQueries({ queryKey: ['report-monthly'] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>

        {/* Account */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: c.textFaint, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 }}>
          ACCOUNT
        </Text>

        <View style={{
          backgroundColor: c.card, borderRadius: 16, padding: 16,
          borderWidth: 1, borderColor: c.cardBorder, marginBottom: 24,
          flexDirection: 'row', alignItems: 'center', gap: 14,
        }}>
          <View style={{
            width: 48, height: 48, borderRadius: 24,
            backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: c.onColor, fontWeight: '700', fontSize: 18 }}>
              {user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: c.text, fontSize: 15 }}>
              {user?.fullName ?? 'User'}
            </Text>
            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
              {user?.emailAddresses?.[0]?.emailAddress ?? ''}
            </Text>
          </View>
        </View>

        {/* Appearance */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: c.textFaint, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 }}>
          APPEARANCE
        </Text>

        <View style={{
          backgroundColor: c.card, borderRadius: 16, padding: 6,
          borderWidth: 1, borderColor: c.cardBorder, marginBottom: 24,
          flexDirection: 'row', gap: 6,
        }}>
          {THEME_OPTIONS.map(opt => {
            const active = mode === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setMode(opt.value)}
                activeOpacity={0.8}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                  backgroundColor: active ? c.primary : 'transparent',
                }}
              >
                <Text style={{ fontSize: 18, marginBottom: 3 }}>{opt.icon}</Text>
                <Text style={{
                  fontSize: 13, fontWeight: '700',
                  color: active ? c.onColor : c.textMuted,
                }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Reports — pay-cycle month */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: c.textFaint, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 }}>
          REPORTS
        </Text>

        <View style={{
          backgroundColor: c.card, borderRadius: 16, padding: 16,
          borderWidth: 1, borderColor: c.cardBorder, marginBottom: 24,
        }}>
          <Text style={{ fontWeight: '700', color: c.text, fontSize: 15 }}>My month starts on</Text>
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4, marginBottom: 12, lineHeight: 17 }}>
            Paid at month-end? Set the day your salary usually arrives (e.g. 28) and monthly
            reports will follow your pay cycle instead of the calendar month. Day 1 = normal
            calendar month.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {MONTH_DAYS.map(day => {
              const active = day === monthStartDay;
              return (
                <TouchableOpacity
                  key={day}
                  onPress={() => setStartDay(day)}
                  activeOpacity={0.8}
                  style={{
                    width: 40, height: 34, borderRadius: 10,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? c.primary : 'transparent',
                    borderWidth: 1,
                    borderColor: active ? c.primary : c.inputBorder,
                    opacity: saving && !active ? 0.5 : 1,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: active ? c.onColor : c.textMuted }}>
                    {day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {monthStartDay > 1 && (
            <Text style={{ color: c.textFaint, fontSize: 12, marginTop: 10 }}>
              {monthStartDay > 15
                ? `e.g. "July" report = ${monthStartDay} Jun → ${monthStartDay - 1} Jul`
                : `e.g. "July" report = ${monthStartDay} Jul → ${monthStartDay - 1} Aug`}
            </Text>
          )}
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          onPress={() => signOut()}
          style={{
            borderWidth: 1, borderColor: c.inputBorder, borderRadius: 16,
            paddingVertical: 16, alignItems: 'center', backgroundColor: c.card,
          }}
        >
          <Text style={{ color: c.textMuted, fontWeight: '600', fontSize: 14 }}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}
