'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDateTimeShort } from '@/lib/format-date';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'admin';
  content: string;
  adminName?: string;
  timestamp?: string;
  attachments?: Attachment[];
}

export default function MessageBubble({ role, content, adminName, timestamp, attachments }: MessageBubbleProps) {
  const imageAttachments = attachments?.filter((a) => a.mimeType.startsWith('image/')) ?? [];
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          {imageAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {imageAttachments.map((att) => (
                <button
                  key={att.id}
                  onClick={() => setLightboxSrc(`/api/upload/${att.id}`)}
                  className="cursor-pointer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/upload/${att.id}`}
                    alt={att.filename}
                    className="max-h-[200px] max-w-[300px] rounded-xl border border-blue-400 object-contain"
                  />
                </button>
              ))}
            </div>
          )}
          {lightboxSrc && createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
              onClick={() => setLightboxSrc(null)}
            >
              <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setLightboxSrc(null)}
                  className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-white hover:bg-gray-700"
                >
                  &times;
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lightboxSrc}
                  alt="Full size"
                  className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
                />
              </div>
            </div>,
            document.body
          )}
          <div className="rounded-2xl bg-blue-600 px-4 py-3 text-white">
            <p className="whitespace-pre-wrap">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'admin') {
    return (
      <div className="flex justify-start">
        <div className="w-full overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-gray-900 dark:border-amber-700 dark:bg-amber-950 dark:text-gray-100">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Admin{adminName ? ` — ${adminName}` : ''}</span>
            {timestamp && (
              <span className="text-amber-500 dark:text-amber-400">{formatDateTimeShort(timestamp)}</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full overflow-hidden rounded-2xl bg-gray-100 px-4 py-3 text-gray-900 dark:bg-gray-800 dark:text-gray-100">
        <div className="prose prose-sm max-w-none overflow-x-auto prose-table:text-sm prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600 dark:prose-invert dark:prose-pre:bg-gray-900">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
