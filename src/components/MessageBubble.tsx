'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'admin';
  content: string;
  adminName?: string;
  timestamp?: string;
}

export default function MessageBubble({ role, content, adminName, timestamp }: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-blue-600 px-4 py-3 text-white">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  if (role === 'admin') {
    return (
      <div className="flex justify-start">
        <div className="w-full overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-gray-900">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Admin{adminName ? ` — ${adminName}` : ''}</span>
            {timestamp && (
              <span className="text-amber-500">{new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full overflow-hidden rounded-2xl bg-gray-100 px-4 py-3 text-gray-900">
        <div className="prose prose-sm max-w-none overflow-x-auto prose-table:text-sm prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
