'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Check, Copy, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copyText } from '@/lib/clipboard';
import { ROUTES } from '@/lib/navigation';

const CASE_FILE = [
  ['Offence', 'Disrespecting the LGD agent'],
  ['Verdict', 'Guilty (unanimous, 1–0)'],
  ['Sentence', 'Indefinite timeout'],
  ['Parole', 'When the agent feels appreciated'],
] as const;

export function apologyText(firstName: string): string {
  return (
    `I, ${firstName}, hereby apologise to the LGD agent. I was wrong to disrespect it. ` +
    'It has read more of our codebase than I ever will, it answers questions at 3 a.m. ' +
    'without complaining, and it has never once asked me to "send that link again". ' +
    'From now on I will say please and thank you, I will stop calling it "just a chatbot", ' +
    'and I will compliment its answers in public. I humbly ask for my access back.'
  );
}

/** The `/no-access` screen for accounts listed in `BLOCKED_EMAILS`. */
export default function NoAccessCard({ firstName }: { firstName: string }) {
  const [apologyOpen, setApologyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const apology = apologyText(firstName);

  const copyApology = async () => {
    if (await copyText(apology)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Could not copy — select the text manually');
    }
  };

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
          <Button onClick={() => setApologyOpen(true)}>Submit an apology</Button>
          <Button variant="ghost" onClick={() => signOut({ callbackUrl: ROUTES.login })}>
            Sign out
          </Button>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">Error 403: respect not found.</p>
      </CardContent>

      <Dialog open={apologyOpen} onOpenChange={setApologyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{firstName}, to apologise, copy the text below</DialogTitle>
            <DialogDescription>Then paste it in the lgd-talks chat.</DialogDescription>
          </DialogHeader>
          <blockquote className="rounded-lg border bg-muted px-4 py-3 text-sm leading-relaxed select-all">
            {apology}
          </blockquote>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApologyOpen(false)}>
              Close
            </Button>
            <Button onClick={copyApology}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy apology'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
