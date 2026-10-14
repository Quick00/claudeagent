// Client-safe: imported by the composer as well as the upload route, so no
// Node-only imports here.

export type UploadKind = 'image' | 'pdf' | 'text' | 'spreadsheet' | 'document';

export type UploadType = {
  mime: string;
  ext: string;
  kind: UploadKind;
  /** Extra file extensions that map to this type (`.yml` for YAML, `.jpeg` for JPEG). */
  aliases?: string[];
};

export const UPLOAD_TYPES: readonly UploadType[] = [
  { mime: 'image/jpeg', ext: 'jpg', kind: 'image', aliases: ['jpeg'] },
  { mime: 'image/png', ext: 'png', kind: 'image' },
  { mime: 'image/gif', ext: 'gif', kind: 'image' },
  { mime: 'image/webp', ext: 'webp', kind: 'image' },
  { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', kind: 'spreadsheet' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', kind: 'document' },
  { mime: 'text/plain', ext: 'txt', kind: 'text' },
  { mime: 'text/csv', ext: 'csv', kind: 'text' },
  { mime: 'text/tab-separated-values', ext: 'tsv', kind: 'text' },
  { mime: 'text/markdown', ext: 'md', kind: 'text' },
  { mime: 'application/json', ext: 'json', kind: 'text' },
  { mime: 'text/plain', ext: 'log', kind: 'text' },
  { mime: 'application/xml', ext: 'xml', kind: 'text' },
  { mime: 'application/yaml', ext: 'yaml', kind: 'text', aliases: ['yml'] },
];

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** The upload type a filename claims to be. The server still checks the bytes. */
export function uploadTypeForFilename(filename: string): UploadType | null {
  const ext = fileExtension(filename);
  if (!ext) return null;
  return UPLOAD_TYPES.find((t) => t.ext === ext || t.aliases?.includes(ext)) ?? null;
}

export function uploadTypeForMime(mime: string): UploadType | null {
  return UPLOAD_TYPES.find((t) => t.mime === mime) ?? null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** For `<input type="file" accept>`. Extensions, because browsers give `.md`/`.log`/`.yaml` no MIME type. */
export const UPLOAD_ACCEPT = UPLOAD_TYPES.flatMap((t) => [t.ext, ...(t.aliases ?? [])])
  .map((ext) => `.${ext}`)
  .join(',');

export const UPLOAD_TYPES_LABEL = 'images, PDF, Excel (.xlsx), Word (.docx) and text files (.txt, .csv, .md, .json, .log, .xml, .yaml)';
