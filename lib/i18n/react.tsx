'use client';

import { createContext, useContext } from 'react';
import { EN, type T } from './ui';

/** The page's translator for client components (English unless a localized page provides one). */
export const UiContext = createContext<T>(EN);
export const useT = () => useContext(UiContext);
