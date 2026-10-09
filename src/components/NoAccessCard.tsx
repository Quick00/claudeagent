'use client';

import { signOut } from 'next-auth/react';
import { Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ROUTES } from '@/lib/navigation';

export const APOLOGY_URL = 'https://www.youtube.com/watch?v=Aq5WXmQQooo';

const CASE_FILE = [
  ['Offence', 'Disrespecting the LGD agent'],
  ['Verdict', 'Guilty (unanimous, 1–0)'],
  ['Sentence', 'Indefinite timeout'],
  ['Parole', 'When the agent feels appreciated'],
] as const;

/** The `/no-access` screen for accounts listed in `BLOCKED_EMAILS`. */
export default function NoAccessCard() {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col items-center gap-5 px-6 py-8 text-center">
        <span className="mb-2 flex size-20 items-center justify-center rounded-full bg-destructive/10">
          <Gavel className="size-10 text-destructive motion-safe:animate-bounce-slow" />
        </span>

        <h1 className="text-2xl font-bold text-balance">You don&apos;t disrespect the LGD agent.</h1>
        <p className="-mt-2 text-muted-foreground">
          The agent has reviewed your recent behaviour and decided it needs some space. It&apos;s not
          you. Actually, it is you.
        </p>

        <section
          aria-label="Case file"
          className="w-full rounded-lg border border-dashed bg-muted px-4 py-3.5 text-left text-sm"
        >
          <p className="mb-2.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            Case file #403
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {CASE_FILE.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <a href={APOLOGY_URL} target="_blank" rel="noopener noreferrer">
              Submit an apology
            </a>
          </Button>
          <Button variant="ghost" onClick={() => signOut({ callbackUrl: ROUTES.login })}>
            Sign out
          </Button>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">Error 403: respect not found.</p>
      </CardContent>
    </Card>
  );
}
