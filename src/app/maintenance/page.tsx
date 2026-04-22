'use client';

import { useEffect, useState } from 'react';

export default function MaintenancePage() {
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (countdown !== 0) return;
    setCountdown(10);
    fetch('/api/maintenance-status')
      .then((res) => {
        if (res.ok) {
          const data = res.json();
          return data;
        }
      })
      .then((data) => {
        if (data && !data.maintenance) {
          window.location.href = '/';
        }
      })
      .catch(() => {});
  }, [countdown]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md px-6 text-center">
        {/* Robot mascot */}
        <div className="mb-8 flex justify-center">
          <svg
            className="h-40 w-40 animate-bounce-slow"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Hard hat */}
            <rect x="55" y="30" width="90" height="20" rx="4" className="fill-amber-400" />
            <rect x="45" y="45" width="110" height="10" rx="2" className="fill-amber-500" />

            {/* Head */}
            <rect x="55" y="55" width="90" height="70" rx="12" className="fill-gray-300 dark:fill-gray-600" />

            {/* Eyes */}
            <circle cx="82" cy="85" r="10" className="fill-white" />
            <circle cx="118" cy="85" r="10" className="fill-white" />
            <circle cx="82" cy="85" r="5" className="fill-blue-500 animate-blink" />
            <circle cx="118" cy="85" r="5" className="fill-blue-500 animate-blink" />

            {/* Mouth */}
            <rect x="80" y="105" width="40" height="6" rx="3" className="fill-gray-400 dark:fill-gray-500" />

            {/* Body */}
            <rect x="60" y="130" width="80" height="50" rx="8" className="fill-gray-300 dark:fill-gray-600" />

            {/* Wrench in hand */}
            <g className="origin-center animate-spin-slow" style={{ transformOrigin: '155px 155px' }}>
              <rect x="145" y="140" width="8" height="30" rx="2" className="fill-gray-500 dark:fill-gray-400" />
              <circle cx="149" cy="138" r="8" className="fill-none stroke-gray-500 dark:stroke-gray-400" strokeWidth="3" />
            </g>

            {/* Antenna */}
            <line x1="100" y1="30" x2="100" y2="15" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="3" />
            <circle cx="100" cy="12" r="5" className="fill-red-400 animate-pulse" />
          </svg>
        </div>

        {/* Message */}
        <h1 className="mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
          We&apos;re tuning things up!
        </h1>
        <p className="mb-6 text-gray-500 dark:text-gray-400">
          Our robots are hard at work making things better. We&apos;ll be back shortly.
        </p>

        {/* Floating gears */}
        <div className="flex justify-center gap-4 text-gray-300 dark:text-gray-700">
          <svg className="h-6 w-6 animate-spin-slow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 6a2 2 0 110-4 2 2 0 010 4z" />
            <path d="M21.17 10.22l-1.63-.47a7.17 7.17 0 00-.57-1.38l.8-1.47a.5.5 0 00-.08-.56l-1.53-1.53a.5.5 0 00-.56-.08l-1.47.8a7.17 7.17 0 00-1.38-.57l-.47-1.63a.5.5 0 00-.48-.35h-2.16a.5.5 0 00-.48.35l-.47 1.63a7.17 7.17 0 00-1.38.57l-1.47-.8a.5.5 0 00-.56.08L5.31 6.34a.5.5 0 00-.08.56l.8 1.47a7.17 7.17 0 00-.57 1.38l-1.63.47a.5.5 0 00-.35.48v2.16a.5.5 0 00.35.48l1.63.47c.14.48.33.94.57 1.38l-.8 1.47a.5.5 0 00.08.56l1.53 1.53a.5.5 0 00.56.08l1.47-.8c.44.24.9.43 1.38.57l.47 1.63a.5.5 0 00.48.35h2.16a.5.5 0 00.48-.35l.47-1.63c.48-.14.94-.33 1.38-.57l1.47.8a.5.5 0 00.56-.08l1.53-1.53a.5.5 0 00.08-.56l-.8-1.47c.24-.44.43-.9.57-1.38l1.63-.47a.5.5 0 00.35-.48v-2.16a.5.5 0 00-.35-.48z" />
          </svg>
          <svg className="h-8 w-8 animate-spin-slow-reverse" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 6a2 2 0 110-4 2 2 0 010 4z" />
            <path d="M21.17 10.22l-1.63-.47a7.17 7.17 0 00-.57-1.38l.8-1.47a.5.5 0 00-.08-.56l-1.53-1.53a.5.5 0 00-.56-.08l-1.47.8a7.17 7.17 0 00-1.38-.57l-.47-1.63a.5.5 0 00-.48-.35h-2.16a.5.5 0 00-.48.35l-.47 1.63a7.17 7.17 0 00-1.38.57l-1.47-.8a.5.5 0 00-.56.08L5.31 6.34a.5.5 0 00-.08.56l.8 1.47a7.17 7.17 0 00-.57 1.38l-1.63.47a.5.5 0 00-.35.48v2.16a.5.5 0 00.35.48l1.63.47c.14.48.33.94.57 1.38l-.8 1.47a.5.5 0 00.08.56l1.53 1.53a.5.5 0 00.56.08l1.47-.8c.44.24.9.43 1.38.57l.47 1.63a.5.5 0 00.48.35h2.16a.5.5 0 00.48-.35l.47-1.63c.48-.14.94-.33 1.38-.57l1.47.8a.5.5 0 00.56-.08l1.53-1.53a.5.5 0 00.08-.56l-.8-1.47c.24-.44.43-.9.57-1.38l1.63-.47a.5.5 0 00.35-.48v-2.16a.5.5 0 00-.35-.48z" />
          </svg>
          <svg className="h-5 w-5 animate-spin-slow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 6a2 2 0 110-4 2 2 0 010 4z" />
            <path d="M21.17 10.22l-1.63-.47a7.17 7.17 0 00-.57-1.38l.8-1.47a.5.5 0 00-.08-.56l-1.53-1.53a.5.5 0 00-.56-.08l-1.47.8a7.17 7.17 0 00-1.38-.57l-.47-1.63a.5.5 0 00-.48-.35h-2.16a.5.5 0 00-.48.35l-.47 1.63a7.17 7.17 0 00-1.38.57l-1.47-.8a.5.5 0 00-.56.08L5.31 6.34a.5.5 0 00-.08.56l.8 1.47a7.17 7.17 0 00-.57 1.38l-1.63.47a.5.5 0 00-.35.48v2.16a.5.5 0 00.35.48l1.63.47c.14.48.33.94.57 1.38l-.8 1.47a.5.5 0 00.08.56l1.53 1.53a.5.5 0 00.56.08l1.47-.8c.44.24.9.43 1.38.57l.47 1.63a.5.5 0 00.48.35h2.16a.5.5 0 00.48-.35l.47-1.63c.48-.14.94-.33 1.38-.57l1.47.8a.5.5 0 00.56-.08l1.53-1.53a.5.5 0 00.08-.56l-.8-1.47c.24-.44.43-.9.57-1.38l1.63-.47a.5.5 0 00.35-.48v-2.16a.5.5 0 00-.35-.48z" />
          </svg>
        </div>

        <p className="mt-6 text-xs text-gray-400 dark:text-gray-600">
          Checking again in {countdown}s...
        </p>
      </div>

      {/* Custom animations */}
      <style jsx>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes blink {
          0%, 90%, 100% { opacity: 1; }
          95% { opacity: 0; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes spin-slow-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        :global(.animate-bounce-slow) {
          animation: bounce-slow 3s ease-in-out infinite;
        }
        :global(.animate-blink) {
          animation: blink 4s ease-in-out infinite;
        }
        :global(.animate-spin-slow) {
          animation: spin-slow 8s linear infinite;
        }
        :global(.animate-spin-slow-reverse) {
          animation: spin-slow-reverse 6s linear infinite;
        }
      `}</style>
    </div>
  );
}
