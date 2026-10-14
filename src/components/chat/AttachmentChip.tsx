'use client';

import { File, FileSpreadsheet, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFileSize, type UploadKind } from '@/lib/upload-types';

const ICONS: Partial<Record<UploadKind, typeof File>> = {
  spreadsheet: FileSpreadsheet,
  document: FileText,
  pdf: FileText,
  text: FileText,
};

type AttachmentChipProps = {
  filename: string;
  size: number;
  kind: UploadKind | undefined;
  href?: string;
  className?: string;
};

/** A non-image attachment: icon, name and size. With `href` it opens or downloads the file. */
export function AttachmentChip({ filename, size, kind, href, className }: AttachmentChipProps) {
  const Icon = (kind && ICONS[kind]) ?? File;
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{filename}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(size)}</span>
    </>
  );
  const classes = cn(
    'flex h-10 max-w-56 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground',
    className,
  );

  if (!href) return <div className={classes}>{body}</div>;
  return (
    <a href={href} target="_blank" rel="noopener" className={cn(classes, 'hover:bg-muted')}>
      {body}
    </a>
  );
}
