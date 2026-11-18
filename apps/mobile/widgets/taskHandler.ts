import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { readSnapshot, writeSnapshot, readHideAmounts, WIDGET_NAMES, type WidgetName } from './snapshot';
import { renderWidget } from './VeloraWidgets';
import { loadNews } from './refresh';

// Android calls this headlessly (app closed) when a widget is added, resized,
// or hits its periodic update. Everything renders from the stored snapshot;
// only News fetches, because its public RSS needs no sign-in.

const NEWS_MAX_AGE_MS = 25 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget: draw }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') return;
  const name = widgetInfo.widgetName as WidgetName;
  if (!(WIDGET_NAMES as readonly string[]).includes(name)) return;

  let snap = await readSnapshot();

  if (name === 'VeloraNews' && (!snap.news || Date.now() - snap.news.at > NEWS_MAX_AGE_MS)) {
    const news = await withTimeout(loadNews().catch(() => null), 12_000);
    if (news) {
      snap = { ...(await readSnapshot()), news: { at: Date.now(), data: news } };
      await writeSnapshot(snap);
    }
  }

  draw(renderWidget(name, snap, await readHideAmounts()));
}
