"use no memo"; // widget layouts are plain functions the widget library calls directly; React Compiler must not transform them
import React from 'react';
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetRepresentation } from 'react-native-android-widget';
import { readerDeepLink } from '@/lib/newsReader';
import { TOGGLE_HABIT, rollHabits, dueToday, shownStreak } from './habitTaps';
import type {
  WidgetName, WidgetSnapshot, TodayData, HabitsData, HabitItem, SafetyData, BillItem, JobsData, NewsData,
} from './snapshot';

// ─────────────────────────────────────────────────────────────────────────────
// Home-screen widget layouts. These are NOT React Native views: the library turns
// this JSX into native Android RemoteViews, so only FlexWidget/TextWidget and
// their own style props are available. Every widget renders a light and a dark
// variant; Android picks one from the system theme.
// ─────────────────────────────────────────────────────────────────────────────

type Hex = `#${string}`;
interface Palette {
  bg: Hex; card: Hex; text: Hex; muted: Hex; faint: Hex;
  primary: Hex; onPrimary: Hex; success: Hex; danger: Hex; warning: Hex;
}

const LIGHT: Palette = {
  bg: '#ffffff', card: '#f3f4f6', text: '#111827', muted: '#6b7280', faint: '#9ca3af',
  primary: '#6366f1', onPrimary: '#ffffff', success: '#16a34a', danger: '#dc2626', warning: '#ca8a04',
};
const DARK: Palette = {
  bg: '#171922', card: '#232633', text: '#f1f5f9', muted: '#a3b0c2', faint: '#7c8798',
  primary: '#818cf8', onPrimary: '#0a0a14', success: '#22c55e', danger: '#f87171', warning: '#eab308',
};

// ─── Formatting ──────────────────────────────────────────────────────────────

function money(n: number, hide: boolean, compact = false): string {
  if (hide) return '₹ ••••';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const one = (x: number) => x.toFixed(1).replace(/\.0$/, ''); // 15.0 → 15
  if (compact && a >= 1e7) return `${sign}₹${one(a / 1e7)}Cr`;
  if (compact && a >= 1e5) return `${sign}₹${one(a / 1e5)}L`;
  if (compact && a >= 1e4) return `${sign}₹${one(a / 1e3)}K`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}

function months(m: number | null): string {
  if (m == null || !isFinite(m)) return '—';
  if (m >= 24) return `${(m / 12).toFixed(1)} yrs`;
  if (m >= 1) return `${m.toFixed(1)} mo`;
  const weeks = Math.max(1, Math.round(m * 4.345));
  return `${weeks} wk${weeks === 1 ? '' : 's'}`;
}

function ago(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function localIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dueLabel(dueIso: string): string {
  const days = Math.round((Date.parse(dueIso + 'T00:00:00') - Date.parse(localIso() + 'T00:00:00')) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function open(uri: string) {
  return { clickAction: 'OPEN_URI' as const, clickActionData: { uri } };
}

function Frame({ p, children, uri }: { p: Palette; children: React.ReactNode; uri?: string }) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', backgroundColor: p.bg,
        borderRadius: 20, padding: 14, flexDirection: 'column',
      }}
      {...(uri ? open(uri) : { clickAction: 'OPEN_APP' })}
    >
      {children}
    </FlexWidget>
  );
}

function Header({ p, title, right }: { p: Palette; title: string; right?: string }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <TextWidget text={title} style={{ fontSize: 14, fontWeight: '700', color: p.text }} />
      {right ? <TextWidget text={right} style={{ fontSize: 11, color: p.faint }} /> : null}
    </FlexWidget>
  );
}

function Message({ p, title, text, uri }: { p: Palette; title: string; text: string; uri?: string }) {
  return (
    <Frame p={p} uri={uri}>
      <Header p={p} title={title} />
      <TextWidget text={text} maxLines={3} style={{ fontSize: 13, color: p.muted, marginTop: 8 }} />
    </Frame>
  );
}

function Stat({ p, label, value, color }: { p: Palette; label: string; value: string; color?: Hex }) {
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', backgroundColor: p.card, borderRadius: 12, padding: 8 }}>
      <TextWidget text={label} style={{ fontSize: 11, color: p.muted }} />
      <TextWidget text={value} maxLines={1} style={{ fontSize: 15, fontWeight: '700', color: color ?? p.text, marginTop: 2 }} />
    </FlexWidget>
  );
}

// ─── The widgets ─────────────────────────────────────────────────────────────

function Today({ p, d, at, hide }: { p: Palette; d: TodayData; at: number; hide: boolean }) {
  const left = d.budgetLeft;
  return (
    <Frame p={p}>
      <Header p={p} title="💸 Today" right={ago(at)} />
      <TextWidget text={money(d.todaySpent, hide)} maxLines={1} style={{ fontSize: 26, fontWeight: '800', color: p.text, marginTop: 6 }} />
      <TextWidget text="spent today" style={{ fontSize: 11, color: p.muted }} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', marginTop: 10, flexGap: 8 }}>
        <Stat p={p} label="This month" value={money(d.monthSpent, hide, true)} />
        {left == null
          ? <Stat p={p} label="Income" value={money(d.monthIncome, hide, true)} color={p.success} />
          : <Stat p={p} label="Budget left" value={money(left, hide, true)} color={left < 0 ? p.danger : p.success} />}
      </FlexWidget>
    </Frame>
  );
}

function QuickBtn({ p, label, uri, filled }: { p: Palette; label: string; uri?: string; filled?: boolean }) {
  return (
    <FlexWidget
      style={{
        flex: 1, height: 'match_parent', borderRadius: 14, alignItems: 'center', justifyContent: 'center',
        backgroundColor: filled ? p.primary : p.card,
      }}
      {...(uri ? open(uri) : { clickAction: 'OPEN_APP' })}
    >
      <TextWidget text={label} style={{ fontSize: 13, fontWeight: '700', color: filled ? p.onPrimary : p.text }} />
    </FlexWidget>
  );
}

function QuickAdd({ p }: { p: Palette }) {
  return (
    <FlexWidget
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: 20, padding: 8, flexDirection: 'row', flexGap: 8 }}
    >
      <QuickBtn p={p} label="− Expense" uri="velora://transactions?add=expense" filled />
      <QuickBtn p={p} label="+ Income" uri="velora://transactions?add=income" />
      {/* Opening the app runs the automatic SMS import and refreshes all widgets. */}
      <QuickBtn p={p} label="🔄 Sync" />
    </FlexWidget>
  );
}

// Habits: a progress bar for today plus a scrollable list where each circle
// ticks the habit right on the home screen (see habitTaps.ts for how the tap
// reaches the server).
function HabitRow({ p, h }: { p: Palette; h: HabitItem }) {
  const done = h.status === 'DONE';
  const half = h.status === 'PARTIAL';
  const streak = shownStreak(h);
  return (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}
      {...open('velora://habits')}
    >
      <TextWidget text={h.icon} style={{ fontSize: 17 }} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', marginLeft: 10 }}>
        <TextWidget
          text={h.name}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 14, fontWeight: done ? '400' : '600', color: done ? p.faint : p.text }}
        />
        {streak > 0
          ? <TextWidget text={`🔥 ${streak} day${streak === 1 ? '' : 's'}`} style={{ fontSize: 10, color: p.faint, marginTop: 1 }} />
          : null}
      </FlexWidget>
      {/* Generous padding: the whole area around the circle is the tap target. */}
      <FlexWidget
        style={{ paddingLeft: 14, paddingRight: 2, paddingVertical: 4 }}
        clickAction={TOGGLE_HABIT}
        clickActionData={{ id: h.id }}
      >
        <FlexWidget
          style={{
            width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
            backgroundColor: done ? p.success : half ? p.warning : p.bg,
            borderWidth: done || half ? 0 : 2,
            borderColor: p.faint,
          }}
        >
          {done || half
            ? <TextWidget text={done ? '✓' : '½'} style={{ fontSize: 15, fontWeight: '800', color: '#ffffff' }} />
            : null}
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

function Habits({ p, d }: { p: Palette; d: HabitsData }) {
  const uri = 'velora://habits';
  const data = rollHabits(d);
  const items = dueToday(data);
  if (items.length === 0) {
    return <Message p={p} title="🔥 Habits" text="Nothing scheduled today. Enjoy the rest day 🌿" uri={uri} />;
  }
  const done = items.filter(h => h.status === 'DONE').length;
  const half = items.filter(h => h.status === 'PARTIAL').length;
  const pct = Math.round(((done + half / 2) / items.length) * 100);
  const allDone = done === items.length;
  const unsynced = items.some(h => h.status !== h.serverStatus);
  const left = items.length - done;
  const status = allDone ? 'All done today 🎉' : `${left} left today`;

  return (
    // No root click: rows open the app, circles tick the habit.
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', backgroundColor: p.bg,
        borderRadius: 20, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 6, flexDirection: 'column',
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} {...open(uri)}>
        <TextWidget text="🔥 Habits" style={{ fontSize: 14, fontWeight: '700', color: p.text }} />
        <TextWidget text={`${done}/${items.length}`} style={{ fontSize: 15, fontWeight: '800', color: allDone ? p.success : p.primary }} />
      </FlexWidget>

      {/* Progress bar: two weighted segments (widgets have no percentage widths). */}
      <FlexWidget style={{ width: 'match_parent', height: 6, flexDirection: 'row', borderRadius: 3, backgroundColor: p.card, marginTop: 8 }}>
        {pct > 0 ? <FlexWidget style={{ flex: pct, height: 6, borderRadius: 3, backgroundColor: allDone ? p.success : p.primary }} /> : null}
        {pct < 100 ? <FlexWidget style={{ flex: 100 - pct, height: 6 }} /> : null}
      </FlexWidget>

      <TextWidget
        text={unsynced ? `${status} · saves when you open Velora` : status}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 11, color: p.muted, marginTop: 5 }}
      />

      {/* Scrollable, so every habit due today fits — no "+3 more". */}
      <ListWidget style={{ height: 'match_parent', width: 'match_parent', marginTop: 4 }}>
        {items.map(h => <HabitRow key={h.id} p={p} h={h} />)}
      </ListWidget>
    </FlexWidget>
  );
}

function SafetyNet({ p, d, hide }: { p: Palette; d: SafetyData; hide: boolean }) {
  const uri = 'velora://safety-net';
  if (!d.hasData || d.months == null) {
    return <Message p={p} title="🛟 Runway" text="Needs a few weeks of transactions and an emergency fund." uri={uri} />;
  }
  const color = d.months >= 6 ? p.success : d.months >= 3 ? p.warning : p.danger;
  return (
    <Frame p={p} uri={uri}>
      <Header p={p} title="🛟 Runway" />
      <TextWidget text={months(d.months)} maxLines={1} style={{ fontSize: 26, fontWeight: '800', color, marginTop: 6 }} />
      <TextWidget text="on essentials" style={{ fontSize: 11, color: p.muted }} />
      <TextWidget text={`Fund ${money(d.fund, hide, true)}`} maxLines={1} style={{ fontSize: 12, color: p.text, marginTop: 8 }} />
    </Frame>
  );
}

function Bills({ p, d, at, hide }: { p: Palette; d: BillItem[]; at: number; hide: boolean }) {
  const uri = 'velora://recurring';
  const upcoming = d.filter(b => Date.parse(b.due + 'T00:00:00') >= Date.parse(localIso() + 'T00:00:00'));
  if (upcoming.length === 0) {
    return <Message p={p} title="🧾 Due soon" text="Nothing due in the next 7 days 🎉" uri={uri} />;
  }
  return (
    <Frame p={p} uri={uri}>
      <Header p={p} title="🧾 Due soon" right={ago(at)} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 6, flexGap: 4 }}>
        {upcoming.slice(0, 4).map((b, i) => {
          const when = dueLabel(b.due);
          return (
            <FlexWidget key={i} style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <TextWidget
                text={`${b.kind === 'emi' ? '🏦' : '🔁'} ${b.name}`}
                maxLines={1}
                truncate="END"
                style={{ fontSize: 13, color: p.text, width: 150 }}
              />
              <TextWidget
                text={`${money(b.amount, hide, true)} · ${when}`}
                style={{ fontSize: 12, fontWeight: '600', color: when === 'Today' ? p.danger : p.muted }}
              />
            </FlexWidget>
          );
        })}
      </FlexWidget>
    </Frame>
  );
}

function Jobs({ p, d, at }: { p: Palette; d: JobsData; at: number }) {
  if (d.state === 'off') {
    return <Message p={p} title="💼 Jobs" text="Turn on Job Finder in Velora → Settings to see job alerts here." uri="velora://settings" />;
  }
  if (d.state === 'no-searches') {
    return <Message p={p} title="💼 Jobs" text="Save a job search with “Alert me” to see new matches here." uri="velora://jobs" />;
  }
  const uri = d.focusId ? `velora://jobs?focus=${encodeURIComponent(d.focusId)}` : 'velora://jobs';
  return (
    <Frame p={p} uri={uri}>
      <Header p={p} title={d.newCount > 0 ? `💼 ${d.newCount} new job${d.newCount === 1 ? '' : 's'}` : '💼 Jobs'} right={ago(at)} />
      {d.label ? <TextWidget text={d.label} maxLines={1} truncate="END" style={{ fontSize: 11, color: p.muted, marginTop: 2 }} /> : null}
      {d.items.length === 0
        ? <TextWidget text="No new matches since you last looked." style={{ fontSize: 13, color: p.muted, marginTop: 8 }} />
        : (
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 6, flexGap: 4 }}>
            {d.items.slice(0, 3).map((j, i) => (
              <TextWidget key={i} text={`• ${j.title} · ${j.company}`} maxLines={1} truncate="END" style={{ fontSize: 13, color: p.text }} />
            ))}
          </FlexWidget>
        )}
    </Frame>
  );
}

// Custom click action handled by taskHandler.ts (fetches fresh headlines).
export const REFRESH_NEWS = 'REFRESH_NEWS';

function News({ p, d, at, refreshing }: { p: Palette; d: NewsData; at: number; refreshing: boolean }) {
  return (
    // No root click: the list items and header buttons each have their own.
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', backgroundColor: p.bg,
        borderRadius: 20, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 6, flexDirection: 'column',
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget text="📰 Headlines" style={{ fontSize: 14, fontWeight: '700', color: p.text }} {...open('velora://news')} />
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget text={refreshing ? 'refreshing…' : ago(at)} style={{ fontSize: 11, color: p.faint }} />
          <FlexWidget
            style={{ marginLeft: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: p.card }}
            clickAction={REFRESH_NEWS}
          >
            <TextWidget text="↻" style={{ fontSize: 15, fontWeight: '700', color: p.primary }} />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
      {d.items.length === 0
        ? <TextWidget text="Couldn’t load the news. Tap ↻ to try again." maxLines={2} style={{ fontSize: 13, color: p.muted, marginTop: 8 }} />
        : (
          // Scrollable: Android renders this as a native list inside the widget.
          <ListWidget style={{ height: 'match_parent', width: 'match_parent', marginTop: 6 }}>
            {d.items.map((n, i) => (
              <FlexWidget
                key={i}
                style={{ width: 'match_parent', flexDirection: 'column', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: p.card }}
                {...open(readerDeepLink({ url: n.link, title: n.title, source: n.source }))}
              >
                <TextWidget text={n.title} maxLines={2} truncate="END" style={{ fontSize: 13, fontWeight: '600', color: p.text }} />
                <TextWidget text={n.source} maxLines={1} style={{ fontSize: 10, color: p.faint, marginTop: 1 }} />
              </FlexWidget>
            ))}
            {/* End of the list: the News screen has categories and search for more. */}
            <FlexWidget
              key="more"
              style={{ width: 'match_parent', alignItems: 'center', paddingVertical: 10 }}
              {...open('velora://news')}
            >
              <TextWidget text="See more in Velora ›" style={{ fontSize: 12, fontWeight: '700', color: p.primary }} />
            </FlexWidget>
          </ListWidget>
        )}
    </FlexWidget>
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function renderFor(name: WidgetName, s: WidgetSnapshot, hide: boolean, p: Palette, refreshing: boolean): React.JSX.Element {
  if (name === 'VeloraQuickAdd') return <QuickAdd p={p} />;
  if (name === 'VeloraNews') {
    // News needs no sign-in: it's public RSS, refreshed in the background.
    return s.news
      ? <News p={p} d={s.news.data} at={s.news.at} refreshing={refreshing} />
      : <Message p={p} title="📰 Headlines" text="Loading headlines…" uri="velora://news" />;
  }
  if (!s.signedIn) {
    return <Message p={p} title="Velora" text="Sign in to Velora to see this widget." />;
  }
  const loading = (title: string) => <Message p={p} title={title} text="Open Velora once to load this." />;
  switch (name) {
    case 'VeloraToday': return s.today ? <Today p={p} d={s.today.data} at={s.today.at} hide={hide} /> : loading('💸 Today');
    // `day` check: snapshots saved by the first widget version lack ids and can't be ticked.
    case 'VeloraHabits': return s.habits?.data?.day ? <Habits p={p} d={s.habits.data} /> : loading('🔥 Habits');
    case 'VeloraSafetyNet': return s.safety ? <SafetyNet p={p} d={s.safety.data} hide={hide} /> : loading('🛟 Runway');
    case 'VeloraBills': return s.bills ? <Bills p={p} d={s.bills.data} at={s.bills.at} hide={hide} /> : loading('🧾 Due soon');
    case 'VeloraJobs': return s.jobs ? <Jobs p={p} d={s.jobs.data} at={s.jobs.at} /> : loading('💼 Jobs');
    default: return loading('Velora');
  }
}

export function renderWidget(
  name: WidgetName, s: WidgetSnapshot, hide: boolean, opts: { refreshing?: boolean } = {},
): WidgetRepresentation {
  const r = opts.refreshing ?? false;
  return { light: renderFor(name, s, hide, LIGHT, r), dark: renderFor(name, s, hide, DARK, r) };
}
