import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import * as Notifications from 'expo-notifications';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import AddEventSheet, { type EditingEvent } from '@/components/AddEventSheet';
import AppAlert from '@/components/AppAlert';
import { rescheduleAllEvents, cancelEventNotification } from '@/lib/eventNotifications';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

type Kind = 'bill' | 'income' | 'emi' | 'goal' | 'reminder' | 'event';
type EventType = 'BIRTHDAY' | 'ANNIVERSARY' | 'MEMORIAL' | 'FESTIVAL' | 'CUSTOM';

interface CalEvent { date: string; kind: Kind; title: string; amount: number | null; icon: string; }

interface Occasion {
  id: string; title: string; type: EventType; date: string; isSelf: boolean;
  personName: string | null; notifyDaysBefore: number; note: string | null;
  icon: string; nextOccurrence: string; daysUntil: number; isToday: boolean; turning: number;
}

const KIND_LABEL: Record<Kind, string> = {
  bill: 'Bill', income: 'Income', emi: 'EMI', goal: 'Goal', reminder: 'Reminder', event: 'Occasion',
};

// Grouping metadata for the occasions catalog (collapsible sections).
const TYPE_META: Record<EventType, { label: string; icon: string }> = {
  BIRTHDAY:    { label: 'Birthdays',     icon: '🎂' },
  ANNIVERSARY: { label: 'Anniversaries', icon: '💍' },
  FESTIVAL:    { label: 'Festivals',     icon: '🎊' },
  MEMORIAL:    { label: 'Memorials',     icon: '🕯️' },
  CUSTOM:      { label: 'Others',        icon: '🗓️' },
};
const TYPE_ORDER: EventType[] = ['BIRTHDAY', 'ANNIVERSARY', 'FESTIVAL', 'MEMORIAL', 'CUSTOM'];

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function untilLabel(days: number) {
  if (days === 0) return 'Today 🎉';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

export default function CalendarScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Occasion | null>(null);
  // Which type sections of the occasions catalog are expanded.
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
  const [alertData, setAlertData] = useState<{
    title: string; message: string; confirmLabel?: string; confirmDestructive?: boolean; onConfirm?: () => void;
  } | null>(null);

  useEffect(() => { Notifications.requestPermissionsAsync().catch(() => {}); }, []);

  const calQuery = useQuery({
    queryKey: ['calendar'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<CalEvent[]>('/calendar?days=60', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Occasion[]>('/events', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  // Keep device notifications in sync whenever the occasions change.
  useEffect(() => {
    if (eventsQuery.data) {
      rescheduleAllEvents(eventsQuery.data.map(e => ({
        id: e.id, title: e.title, personName: e.personName,
        nextOccurrence: e.nextOccurrence, notifyDaysBefore: e.notifyDaysBefore,
        icon: e.icon, isSelf: e.isSelf,
      }))).catch(() => {});
    }
  }, [eventsQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
  }
  function openAdd() { setEditingEvent(null); setAddOpen(true); }
  function openEdit(o: Occasion) { setEditingEvent(o); setAddOpen(true); }
  function closeSheet() { setAddOpen(false); setEditingEvent(null); }

  function deleteEvent(o: Occasion) {
    setAlertData({
      title: 'Delete Occasion',
      message: `Delete "${o.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        try {
          const token = await getToken();
          await apiFetch(`/events/${o.id}`, token!, { method: 'DELETE' });
          await cancelEventNotification(o.id); // don't let a deleted occasion still ring
          invalidate();
        } catch {
          setAlertData({ title: 'Error', message: 'Failed to delete occasion.' });
        }
      },
    });
  }

  const groups = useMemo(() => {
    const out: { key: string; label: string; events: CalEvent[] }[] = [];
    for (const e of calQuery.data ?? []) {
      const key = e.date.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(e);
      else out.push({ key, label: dayLabel(e.date), events: [e] });
    }
    return out;
  }, [calQuery.data]);

  const occasions = eventsQuery.data ?? []; // API returns soonest-first
  // Occasions grouped by type, in a fixed order, empty types dropped.
  const typeGroups = useMemo(
    () =>
      TYPE_ORDER
        .map(t => ({ type: t, items: occasions.filter(o => o.type === t) }))
        .filter(g => g.items.length > 0),
    [occasions],
  );
  const kindColor = (k: Kind) =>
    k === 'income' ? c.success : k === 'bill' ? c.danger : k === 'emi' ? c.primaryDeep
      : k === 'goal' ? c.primary : k === 'event' ? c.violet : c.warning;

  const loading = calQuery.isLoading || eventsQuery.isLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {addOpen && (
        <AddEventSheet
          visible
          editing={editingEvent as EditingEvent | null}
          onClose={closeSheet}
          onSuccess={() => { invalidate(); closeSheet(); }}
        />
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.text} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={calQuery.isFetching || eventsQuery.isFetching} onRefresh={() => { calQuery.refetch(); eventsQuery.refetch(); }} />}
        >
          {/* Occasions */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.heading}>Calendar</Text>
              <Text style={styles.sub}>Occasions, bills, EMIs & reminders</Text>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Text style={styles.addBtnText}>+ Occasion</Text>
            </TouchableOpacity>
          </View>

          {occasions.length > 0 && (() => {
            const renderOccasion = (o: Occasion, i: number) => (
              <TouchableOpacity key={o.id} style={[styles.row, i > 0 && styles.rowBorder]} activeOpacity={0.7} onPress={() => openEdit(o)}>
                <Text style={styles.rowIcon}>{o.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{o.title}</Text>
                  <Text style={styles.rowSub}>
                    {untilLabel(o.daysUntil)}
                    {o.type === 'BIRTHDAY' && o.turning > 0 ? `  ·  turning ${o.turning}` : ''}
                    {o.isSelf ? '  ·  you' : o.personName ? `  ·  ${o.personName}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteEvent(o)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.deleteIcon}>🗑️</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );

            // Few occasions → simple flat list, no grouping overhead.
            if (occasions.length <= 4) {
              return (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>🎉 Occasions</Text>
                  <View style={styles.card}>{occasions.map(renderOccasion)}</View>
                </View>
              );
            }

            // Many occasions → pin the 3 nearest, collapse the rest by type.
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🎉 Up next</Text>
                <View style={styles.card}>{occasions.slice(0, 3).map(renderOccasion)}</View>

                <Text style={[styles.sectionTitle, { marginTop: 14 }]}>All occasions ({occasions.length})</Text>
                {typeGroups.map(g => {
                  const open = !!openTypes[g.type];
                  const meta = TYPE_META[g.type];
                  return (
                    <View key={g.type} style={{ marginBottom: 8 }}>
                      <TouchableOpacity
                        style={styles.typeHeader}
                        activeOpacity={0.7}
                        onPress={() => setOpenTypes(p => ({ ...p, [g.type]: !open }))}
                      >
                        <Text style={styles.typeHeaderText}>{meta.icon} {meta.label}</Text>
                        <View style={styles.typeHeaderRight}>
                          <View style={styles.typeCountBadge}><Text style={styles.typeCountText}>{g.items.length}</Text></View>
                          <Text style={styles.typeChevron}>{open ? '▾' : '▸'}</Text>
                        </View>
                      </TouchableOpacity>
                      {open && <View style={[styles.card, { marginTop: 6 }]}>{g.items.map(renderOccasion)}</View>}
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Upcoming agenda */}
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Upcoming (60 days)</Text>
          {groups.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyText}>Nothing coming up.</Text>
              <Text style={styles.emptyHint}>Bills, EMIs, goal dates, reminders and occasions show here.</Text>
            </View>
          ) : (
            groups.map(g => (
              <View key={g.key} style={styles.group}>
                <Text style={styles.dayLabel}>{g.label}</Text>
                <View style={styles.card}>
                  {g.events.map((e, i) => (
                    <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
                      <Text style={styles.rowIcon}>{e.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
                        <Text style={[styles.rowKind, { color: kindColor(e.kind) }]}>{KIND_LABEL[e.kind]}</Text>
                      </View>
                      {e.amount != null && (
                        <Text style={[styles.rowAmount, { color: e.kind === 'income' ? c.successDeep : c.text }]}>
                          {e.kind === 'income' ? '+' : ''}{formatINR(e.amount)}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <AppAlert
        visible={!!alertData}
        title={alertData?.title ?? ''}
        message={alertData?.message ?? ''}
        confirmLabel={alertData?.confirmLabel}
        confirmDestructive={alertData?.confirmDestructive}
        onClose={() => setAlertData(null)}
        onConfirm={alertData?.onConfirm}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '700', color: c.text },
  sub: { fontSize: 13, color: c.textFaint, marginTop: 2 },
  addBtn: { backgroundColor: c.primary, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: c.onColor, fontSize: 13, fontWeight: '700' },

  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginBottom: 6, marginLeft: 4 },

  // collapsible type sections of the occasions catalog
  typeHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.chipBg, borderRadius: 12, borderWidth: 1, borderColor: c.chipBorder,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  typeHeaderText: { fontSize: 13, fontWeight: '700', color: c.text },
  typeHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeCountBadge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  typeCountText: { fontSize: 11, fontWeight: '700', color: c.textMuted },
  typeChevron: { fontSize: 13, color: c.textFaint, fontWeight: '700' },

  group: { marginBottom: 14 },
  dayLabel: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginBottom: 6, marginLeft: 4 },
  card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: c.cardBorder },
  rowIcon: { fontSize: 20 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: c.text },
  rowSub: { fontSize: 11, color: c.textFaint, marginTop: 2 },
  rowKind: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  deleteIcon: { fontSize: 16 },

  emptyCard: { backgroundColor: c.card, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, marginTop: 8 },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyText: { fontSize: 15, fontWeight: '600', color: c.textMuted },
  emptyHint: { fontSize: 12, color: c.textFaint, marginTop: 4, textAlign: 'center' },
});
