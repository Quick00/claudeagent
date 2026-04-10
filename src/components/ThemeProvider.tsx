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

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [theme, setTheme] = useState<ResolvedTheme>('light');

  const resolve = useCallback((pref: ThemePreference): ResolvedTheme => {
    return pref === 'system' ? getSystemTheme() : pref;
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('theme') as ThemePreference | null;
    const pref = stored || 'system';
    setPreferenceState(pref);
    const resolved = resolve(pref);
    setTheme(resolved);
    applyTheme(resolved);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const currentPref = localStorage.getItem('theme') as ThemePreference | null || 'system';
      if (currentPref === 'system') {
        const resolved = getSystemTheme();
        setTheme(resolved);
        applyTheme(resolved);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [resolve]);

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
