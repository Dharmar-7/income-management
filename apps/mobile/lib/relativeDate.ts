// Shared relative-date helpers so every screen says "2 days ago" / "Due tomorrow"
// the same way. new Date()/Date.now() is fine here — this is app code and the user
// expects their own local (IST) reckoning.

/** "just now" · "5m ago" · "3h ago" · "2d ago" · then a short date. Takes epoch ms. */
export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Same as relativeTime but takes an ISO string; '' for missing/unparseable. */
export function relativeTimeIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : relativeTime(t);
}

/** Whole-day countdown for due dates: "Due today" · "Due tomorrow" · "In 3 days" · "Overdue 2 days". */
export function relativeDue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.ceil((t - Date.now()) / 86_400_000);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0) return `Overdue ${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'}`;
  return `In ${diff} day${diff === 1 ? '' : 's'}`;
}
