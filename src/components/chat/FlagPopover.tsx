'use client';

import { useState } from 'react';
import { Flag as FlagIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type FlagPopoverProps = {
  hasPendingFlag: boolean;
  submitting: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
};

export function FlagPopover({ hasPendingFlag, submitting, onSubmit }: FlagPopoverProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (hasPendingFlag) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* aria-disabled rather than disabled: a disabled button swallows the
              pointer events the tooltip needs. */}
          <Button variant="secondary" size="sm" aria-disabled className="opacity-60">
            <FlagIcon />
            Flagged
          </Button>
        </TooltipTrigger>
        <TooltipContent>An admin is already looking at this conversation.</TooltipContent>
      </Tooltip>
    );
  }

  const submit = async () => {
    const ok = await onSubmit(reason);
    if (!ok) {
      toast.error('Could not flag this conversation.');
      return;
    }
    toast.success('Flagged for review.');
    setOpen(false);
    setReason('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              <FlagIcon />
              Flag
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Flag this conversation for an admin</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 space-y-2">
        <Label htmlFor="flag-reason">What was wrong?</Label>
        <Textarea
          id="flag-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional — what did Claude get wrong?"
          className="min-h-16"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setReason('');
            }}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={submitting} onClick={submit}>
            {submitting ? 'Flagging...' : 'Submit flag'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
