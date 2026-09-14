'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export type MarkdownDensity = 'default' | 'compact';

/**
 * The single prose class string for the app. Colours come from the `.prose`
 * token overrides in globals.css, so there is no `dark:prose-invert` anywhere.
 * Exported for the TipTap `EditorContent`, which renders its own markup.
 */
export function markdownProseClass(density: MarkdownDensity = 'default', className?: string) {
  return cn(
    'prose max-w-none break-words',
    density === 'compact' ? 'prose-sm' : 'prose-sm sm:prose-base',
    'prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none',
    className,
  );
}

export function MarkdownContent({
  content,
  density = 'default',
  className,
}: {
  content: string;
  density?: MarkdownDensity;
  className?: string;
}) {
  return (
    <div className={markdownProseClass(density, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
