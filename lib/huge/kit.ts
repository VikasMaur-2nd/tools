/**
 * What huge mode takes from the first load instead of importing it: a module both the first load and this
 * lazy chunk imported would move between chunks, and every tool page's first load would grow (measured:
 * TallScroll alone, +752 B gzip on /, +970 B on a tool page). Engine.loadFile hands them over (see open.ts).
 */
import type { ReactNode } from 'react';
import type { TallScroll } from '../engine/tall';

/** Puts children in another element: react-dom's createPortal, handed over by JsonTool (this chunk doesn't import react-dom). */
export type Portal = (children: ReactNode, into: Element) => ReactNode;


export const kit = {} as { Scroll: typeof TallScroll };
