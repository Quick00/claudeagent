'use client';

import Script from 'next/script';
import { useSession } from 'next-auth/react';

declare global {
  interface Window {
    Featurebase: (...args: any[]) => void;
  }
}

export default function FeedbackWidget() {
  const { data: session } = useSession();

  const handleReady = () => {
    if (typeof window.Featurebase !== 'function') return;

    window.Featurebase('initialize_feedback_widget', {
      organization: process.env.NEXT_PUBLIC_FEATUREBASE_ORG,
      placement: 'right',
      theme: 'light',
      email: session?.user?.email ?? undefined,
      name: session?.user?.name ?? undefined,
    });
  };

  const handleClick = () => {
    if (typeof window.Featurebase === 'function') {
      window.Featurebase('manually_open_feedback_widget');
    }
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
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
        Feedback
      </button>
    </>
  );
}
