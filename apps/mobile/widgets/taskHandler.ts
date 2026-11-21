import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { readSnapshot, writeSnapshot, readHideAmounts, WIDGET_NAMES, type WidgetName } from './snapshot';
import { renderWidget, REFRESH_NEWS } from './VeloraWidgets';
import { loadNews } from './refresh';
import { TOGGLE_HABIT, toggleHabitTap } from './habitTaps';

// Android calls this headlessly (app closed) when a widget is added, resized,
// tapped with a custom action, or hits its periodic update. Everything renders
// from the stored snapshot; only News fetches, because its public RSS needs no
// sign-in. Habit ticks are stored locally and sent when the app next opens.

const NEWS_MAX_AGE_MS = 25 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

export async function widgetTaskHandler({
  widgetInfo, widgetAction, clickAction, clickActionData, renderWidget: draw,
}: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') return;
  const name = widgetInfo.widgetName as WidgetName;
  if (!(WIDGET_NAMES as readonly string[]).includes(name)) return;

  // Tick/untick a habit from the widget; it's saved to the server on next app open.
  if (widgetAction === 'WIDGET_CLICK' && clickAction === TOGGLE_HABIT) {
    const id = clickActionData?.id;
    if (typeof id === 'string') await toggleHabitTap(id);
  }

  let snap = await readSnapshot();
  const hide = await readHideAmounts();

  if (name === 'VeloraNews') {
    const manual = widgetAction === 'WIDGET_CLICK' && clickAction === REFRESH_NEWS;
    if (manual || !snap.news || Date.now() - snap.news.at > NEWS_MAX_AGE_MS) {
      if (manual && snap.news) draw(renderWidget(name, snap, hide, { refreshing: true }));
      const news = await withTimeout(loadNews().catch(() => null), 12_000);
      if (news) {
        snap = { ...(await readSnapshot()), news: { at: Date.now(), data: news } };
        await writeSnapshot(snap);
      }
    }
  }

  draw(renderWidget(name, snap, hide));
}
