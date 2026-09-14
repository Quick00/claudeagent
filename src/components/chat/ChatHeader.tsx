'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FlagPopover } from './FlagPopover';

type ChatHeaderProps = {
  conversationId: string;
  /** Only the owner may flag their own conversation. */
  canFlag: boolean;
  hasPendingFlag: boolean;
  flagSubmitting: boolean;
  onFlag: (reason: string) => Promise<boolean>;
};

export function ChatHeader({
  conversationId,
  canFlag,
  hasPendingFlag,
  flagSubmitting,
  onFlag,
}: ChatHeaderProps) {
  const copyId = async () => {
    try {
      await navigator.clipboard?.writeText(conversationId);
      toast.success('Conversation ID copied');
    } catch {
      toast.error('Could not copy the conversation ID');
    }
  };

  return (
    <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="sm" onClick={copyId}>
            <Copy />
            ID
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy conversation ID</TooltipContent>
      </Tooltip>
      {canFlag && (
        <FlagPopover
          hasPendingFlag={hasPendingFlag}
          submitting={flagSubmitting}
          onSubmit={onFlag}
        />
      )}
    </div>
  );
}
