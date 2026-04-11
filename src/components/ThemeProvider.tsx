'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const ThemeContext = createContext<{
  preference: ThemePreference;
  theme: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}>({ preference: 'system', theme: 'light', setPreference: () => {} });

export const useTheme = () => useContext(ThemeContext);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

const VALID_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function getStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem('theme');
  return stored && VALID_PREFERENCES.includes(stored as ThemePreference)
    ? (stored as ThemePreference)
    : 'system';
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredPreference);
  const [theme, setTheme] = useState<ResolvedTheme>(() => {
    const pref = getStoredPreference();
    return pref === 'system' ? getSystemTheme() : pref;
  });

  const resolve = useCallback((pref: ThemePreference): ResolvedTheme => {
    return pref === 'system' ? getSystemTheme() : pref;
  }, []);

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const currentPref = getStoredPreference();
      if (currentPref === 'system') {
        const resolved = getSystemTheme();
        setTheme(resolved);
        applyTheme(resolved);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    localStorage.setItem('theme', pref);
    const resolved = resolve(pref);
    setTheme(resolved);
    applyTheme(resolved);
  };

  return (
    <ThemeContext value={{ preference, theme, setPreference }}>
      {children}
    </ThemeContext>
  );
}
