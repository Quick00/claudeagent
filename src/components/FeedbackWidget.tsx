'use client';

import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { useRef } from 'react';

declare global {
  interface Window {
    Featurebase: (...args: unknown[]) => void;
  }
}

export default function FeedbackWidget() {
  const { data: session } = useSession();
  const identifiedRef = useRef(false);

  const identifyUser = async () => {
    if (identifiedRef.current) return;
    if (typeof window.Featurebase !== 'function') return;
    if (!session?.user?.email) return;

    try {
      const res = await fetch('/api/auth/featurebase');
      if (!res.ok) return;
      const { token } = await res.json();

      window.Featurebase('identify', {
        organization: process.env.NEXT_PUBLIC_FEATUREBASE_ORG,
        featurebaseJwt: token,
      });
      identifiedRef.current = true;
    } catch {
      // Silent fail — widget still works, just without user identification
    }
  };

  const handleReady = () => {
    if (typeof window.Featurebase !== 'function') return;

    window.Featurebase('initialize_feedback_widget', {
      organization: process.env.NEXT_PUBLIC_FEATUREBASE_ORG,
      theme: 'light',
    });

    identifyUser();
  };

  const handleClick = () => {
    window.postMessage({
      target: 'FeaturebaseWidget',
      data: { action: 'openFeedbackWidget' },
    }, '*');
  };

  return (
    <>
      <Script
        id="featurebase-sdk"
        src="https://do.featurebase.app/js/sdk.js"
        strategy="lazyOnload"
        onReady={handleReady}
      />
      <button
        onClick={handleClick}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
        Feedback
      </button>
    </>
  );
}
