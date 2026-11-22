import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import {
  readSnapshot, writeSnapshot, readHideAmounts, readNewsTabs, writeNewsTab, newsFor, withNews, isNewsCategory,
  WIDGET_NAMES, type WidgetName, type NewsCategory,
} from './snapshot';
import { renderWidget, REFRESH_NEWS, SET_NEWS_TAB } from './VeloraWidgets';
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
  const name = widgetInfo.widgetName as WidgetName;
  if (widgetAction === 'WIDGET_DELETED') {
    if (name === 'VeloraNews') await writeNewsTab(widgetInfo.widgetId, null);
    return;
  }
  if (!(WIDGET_NAMES as readonly string[]).includes(name)) return;

  // Tick/untick a habit from the widget; it's saved to the server on next app open.
  if (widgetAction === 'WIDGET_CLICK' && clickAction === TOGGLE_HABIT) {
    const id = clickActionData?.id;
    if (typeof id === 'string') await toggleHabitTap(id);
  }

  let snap = await readSnapshot();
  const hide = await readHideAmounts();

  let newsCategory: NewsCategory = 'top';
  if (name === 'VeloraNews') {
    const click = widgetAction === 'WIDGET_CLICK';
    newsCategory = (await readNewsTabs())[widgetInfo.widgetId] ?? 'top';
    if (click && clickAction === SET_NEWS_TAB && isNewsCategory(clickActionData?.category)) {
      newsCategory = clickActionData.category;
      await writeNewsTab(widgetInfo.widgetId, newsCategory);
    }
    const manual = click && clickAction === REFRESH_NEWS;
    const cur = newsFor(snap, newsCategory);
    if (manual || !cur || Date.now() - cur.at > NEWS_MAX_AGE_MS) {
      // Show the tab switch / spinner straight away, then fetch.
      draw(renderWidget(name, snap, hide, { refreshing: true, newsCategory }));
      const news = await withTimeout(loadNews(newsCategory).catch(() => null), 12_000);
      if (news) {
        snap = withNews(await readSnapshot(), newsCategory, { at: Date.now(), data: news });
        await writeSnapshot(snap);
      }
    }
  }

  draw(renderWidget(name, snap, hide, { newsCategory }));
}
