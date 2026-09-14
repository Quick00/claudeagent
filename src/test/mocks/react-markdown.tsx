import type { ReactNode } from 'react';

// react-markdown is ESM-only. Tests care that the content reaches the DOM,
// not that it is parsed as Markdown.
export default function ReactMarkdown({ children }: { children?: ReactNode }) {
  return <div data-testid="markdown">{children}</div>;
}
