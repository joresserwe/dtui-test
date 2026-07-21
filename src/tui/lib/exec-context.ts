import type { ExecutionContextInfo } from '../../store/types.js';
import { contextTag } from '../../store/console.js';
import type { SelectPickerItem } from '../overlays/SelectPicker.js';
import { t } from './i18n.js';

export { contextTag };

export function contextItems(contexts: ExecutionContextInfo[]): SelectPickerItem[] {
  return contexts.map(c => ({
    value: String(c.id),
    label: c.isDefault ? t('picker.item.ctxDefault') : contextTag(c),
    ...(c.isDefault ? {} : { hint: c.frameId ?? '' }),
  }));
}

export function nonDefaultContextLabels(contexts: ExecutionContextInfo[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const c of contexts) if (!c.isDefault) map.set(c.id, contextTag(c));
  return map;
}
