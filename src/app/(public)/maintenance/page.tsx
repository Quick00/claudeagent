'use client';

import { useEffect, useRef, useState } from 'react';
import { Cog } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function MaintenancePage() {
  const [countdown, setCountdown] = useState(10);
  const probing = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev > 1) return prev - 1;
        if (!probing.current) {
          probing.current = true;
          fetch('/api/maintenance-status')
            .then((res) => res.ok && res.json())
            .then((data) => {
              if (data && !data.maintenance) {
                window.location.href = '/';
              }
            })
            .catch(() => {})
            .finally(() => {
              probing.current = false;
            });
        }
        return 10;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="px-6 py-8 text-center">
        {/* Robot mascot — the maintenance illustration, one of the two inline SVGs allowed in the app. */}
        <div className="mb-8 flex justify-center">
          <svg
            className="h-40 w-40 animate-bounce-slow"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Hard hat */}
            <rect x="55" y="30" width="90" height="20" rx="4" className="fill-warning" />
            <rect x="45" y="45" width="110" height="10" rx="2" className="fill-warning/80" />

            {/* Head */}
            <rect x="55" y="55" width="90" height="70" rx="12" className="fill-muted" />

            {/* Eyes */}
            <circle cx="82" cy="85" r="10" className="fill-card" />
            <circle cx="118" cy="85" r="10" className="fill-card" />
            <circle cx="82" cy="85" r="5" className="animate-blink fill-primary" />
            <circle cx="118" cy="85" r="5" className="animate-blink fill-primary" />

            {/* Mouth */}
            <rect x="80" y="105" width="40" height="6" rx="3" className="fill-muted-foreground" />

            {/* Body */}
            <rect x="60" y="130" width="80" height="50" rx="8" className="fill-muted" />

            {/* Wrench in hand */}
            <g className="origin-center animate-spin-slow" style={{ transformOrigin: '155px 155px' }}>
              <rect x="145" y="140" width="8" height="30" rx="2" className="fill-muted-foreground" />
              <circle cx="149" cy="138" r="8" className="fill-none stroke-muted-foreground" strokeWidth="3" />
            </g>

            {/* Antenna */}
            <line x1="100" y1="30" x2="100" y2="15" className="stroke-muted-foreground" strokeWidth="3" />
            <circle cx="100" cy="12" r="5" className="animate-pulse fill-destructive" />
          </svg>
        </div>

        {/* Message */}
        <h1 className="mb-3 text-2xl font-bold">We&apos;re tuning things up!</h1>
        <p className="mb-6 text-muted-foreground">
          Our robots are hard at work making things better. We&apos;ll be back shortly.
        </p>

        {/* Floating gears */}
        <div className="flex justify-center gap-4 text-muted-foreground/60">
          <Cog className="size-6 animate-spin-slow" />
          <Cog className="size-8 animate-spin-slow" />
          <Cog className="size-5 animate-spin-slow" />
        </div>

        <p className="mt-6 text-xs text-muted-foreground">Checking again in {countdown}s...</p>
      </CardContent>
    </Card>
  );
}
