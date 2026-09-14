'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { MarkdownContent } from '@/components/shared/MarkdownContent';
import { formatDateTimeShort } from '@/lib/format-date';
import type { Attachment } from './useConversation';

export type MessageBubbleProps = {
  role: 'user' | 'assistant' | 'admin';
  content: string;
  adminName?: string;
  timestamp?: string;
  attachments?: Attachment[];
};

export function MessageBubble({
  role,
  content,
  adminName,
  timestamp,
  attachments,
}: MessageBubbleProps) {
  const images = attachments?.filter((a) => a.mimeType.startsWith('image/')) ?? [];
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {images.map((att) => (
                <Button
                  key={att.id}
                  variant="ghost"
                  size="icon"
                  className="size-auto p-0 hover:bg-transparent"
                  onClick={() => setLightboxSrc(`/api/upload/${att.id}`)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/upload/${att.id}`}
                    alt={att.filename}
                    className="max-h-[200px] max-w-[300px] rounded-xl border border-primary object-contain"
                  />
                </Button>
              ))}
            </div>
          )}
          <Dialog open={lightboxSrc !== null} onOpenChange={(open) => !open && setLightboxSrc(null)}>
            <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
              <DialogTitle className="sr-only">Attached image</DialogTitle>
              {lightboxSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={lightboxSrc}
                  alt="Full size attachment"
                  className="max-h-[80vh] w-full rounded-lg object-contain"
                />
              )}
            </DialogContent>
          </Dialog>
          <div className="rounded-2xl bg-primary px-4 py-3 text-primary-foreground">
            <p className="whitespace-pre-wrap">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'admin') {
    return (
      <div className="flex justify-start">
        <div className="w-full overflow-hidden rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-foreground">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-warning">
            <ShieldCheck className="size-3.5" />
            <span>Admin{adminName ? ` — ${adminName}` : ''}</span>
            {timestamp && (
              <span className="text-muted-foreground">{formatDateTimeShort(timestamp)}</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full overflow-hidden rounded-2xl bg-muted px-4 py-3 text-foreground">
        <MarkdownContent content={content} density="compact" className="overflow-x-auto" />
      </div>
    </div>
  );
}
