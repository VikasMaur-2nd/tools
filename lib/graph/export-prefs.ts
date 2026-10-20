/*
 * The last image-export choices (format, area, background, size), kept in
 * localStorage: the export dialog edits them, and "Copy graph image" reuses them.
 */
import type { GraphExport } from './types';

export type ExportPrefs = Omit<GraphExport, 'background'> & { bg: 'theme' | 'white' | 'transparent' | 'custom'; color: string };

const KEY = 'jf:graph-export';
export const DEFAULT_EXPORT: ExportPrefs = { format: 'png', area: 'all', bg: 'theme', color: '#ffffff', scale: 2 };

export function loadExportPrefs(): ExportPrefs {
  try {
    const v = { ...DEFAULT_EXPORT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as ExportPrefs;
    // Stored values are only trusted from the known sets.
    if (!['png', 'jpeg', 'svg'].includes(v.format)) v.format = 'png';
    if (!['all', 'view', 'branch'].includes(v.area)) v.area = 'all';
    if (!['theme', 'white', 'transparent', 'custom'].includes(v.bg)) v.bg = 'theme';
    if (!/^#[0-9a-f]{6}$/i.test(v.color)) v.color = '#ffffff';
    if (![1, 2, 3].includes(v.scale)) v.scale = 2;
    return v;
  } catch {
    return DEFAULT_EXPORT;
  }
}

export function saveExportPrefs(p: ExportPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

/** Export options from saved choices (JPEG has no transparency: it gets the theme's colour). */
export function exportOptions(p: ExportPrefs): GraphExport {
  const bg = p.format === 'jpeg' && p.bg === 'transparent' ? 'theme' : p.bg;
  return { format: p.format, area: p.area, background: bg === 'white' ? '#ffffff' : bg === 'custom' ? p.color : bg, scale: p.scale };
}
