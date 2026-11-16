import { config } from '@/lib/config';
import { stripSourceReferences } from '@/lib/sanitize-response';
import { buildXlsx } from '@/lib/generate-xlsx';
import { buildPdf } from '@/lib/generate-pdf';

export type Cell = string | number | boolean | null;
export type SheetInput = { name: string; columns: string[]; rows: Cell[][] };
export type GenerateRequest =
  | { format: 'xlsx'; filename: string; sheets: SheetInput[] }
  | { format: 'pdf'; filename: string; title?: string; content: string };

type Validation = { ok: true; request: GenerateRequest } | { ok: false; error: string };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

const fail = (error: string): Validation => ({ ok: false, error });
const isCell = (v: unknown): v is Cell =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function validateSheets(raw: unknown): SheetInput[] | string {
  const limits = config.generatedFiles;
  if (!Array.isArray(raw) || raw.length === 0) return 'xlsx needs "sheets": a non-empty array of { name, columns, rows }.';
  if (raw.length > limits.maxSheets) return `A workbook can have at most ${limits.maxSheets} sheets.`;

  let cells = 0;
  const sheets: SheetInput[] = [];
  for (const [i, s] of raw.entries()) {
    const label = typeof s?.name === 'string' && s.name ? `"${s.name}"` : `#${i + 1}`;
    if (!s || typeof s !== 'object') return `Sheet ${label} must be an object.`;
    const { name, columns, rows } = s as Record<string, unknown>;
    if (!Array.isArray(columns) || columns.length === 0 || !columns.every((c) => typeof c === 'string')) {
      return `Sheet ${label} needs "columns": a non-empty array of strings.`;
    }
    if (columns.length > limits.maxColumns) return `Sheet ${label} has more than ${limits.maxColumns} columns.`;
    if (!Array.isArray(rows)) return `Sheet ${label} needs "rows": an array of arrays.`;
    if (rows.length > limits.maxRowsPerSheet) return `Sheet ${label} has more than ${limits.maxRowsPerSheet} rows.`;
    for (const [r, row] of rows.entries()) {
      const where = `Sheet ${label}, row ${r + 1}`;
      if (!Array.isArray(row)) return `${where} must be an array.`;
      if (row.length > columns.length) return `${where} has ${row.length} values but only ${columns.length} columns.`;
      for (const cell of row) {
        if (!isCell(cell)) return `${where}: every value must be text, a number, true/false or null.`;
        if (typeof cell === 'string' && cell.length > limits.maxCellChars) {
          return `${where}: a value is longer than ${limits.maxCellChars} characters.`;
        }
      }
      cells += row.length;
    }
    if (cells > limits.maxCells) return `A workbook can hold at most ${limits.maxCells} values in total.`;
    sheets.push({ name: typeof name === 'string' ? name : '', columns: columns as string[], rows: rows as Cell[][] });
  }
  return sheets;
}

export function validateGenerateRequest(input: unknown): Validation {
  if (!input || typeof input !== 'object') return fail('Expected an object.');
  const body = input as Record<string, unknown>;
  const filename = typeof body.filename === 'string' ? body.filename : '';

  if (body.format === 'xlsx') {
    const sheets = validateSheets(body.sheets);
    if (typeof sheets === 'string') return fail(sheets);
    return { ok: true, request: { format: 'xlsx', filename, sheets } };
  }
  if (body.format === 'pdf') {
    if (typeof body.content !== 'string' || !body.content.trim()) return fail('pdf needs "content": the document as Markdown.');
    if (body.content.length > config.generatedFiles.maxPdfChars) {
      return fail(`pdf content can be at most ${config.generatedFiles.maxPdfChars} characters.`);
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title : undefined;
    return { ok: true, request: { format: 'pdf', filename, title, content: body.content } };
  }
  return fail('"format" must be "xlsx" or "pdf".');
}

const clean = (text: string) => stripSourceReferences(text).trim();

/** Same scrubbing as chat answers: no repo paths or source file names inside a file people pass around. */
export function sanitizeGenerateRequest(req: GenerateRequest): GenerateRequest {
  if (req.format === 'pdf') {
    return { ...req, title: req.title === undefined ? undefined : clean(req.title), content: stripSourceReferences(req.content) };
  }
  return {
    ...req,
    sheets: req.sheets.map((s) => ({
      name: clean(s.name),
      columns: s.columns.map(clean),
      rows: s.rows.map((row) => row.map((cell) => (typeof cell === 'string' ? clean(cell) : cell))),
    })),
  };
}

/** A name safe on disk and inside a quoted Content-Disposition header. */
export function generatedFilename(name: string, ext: 'xlsx' | 'pdf'): string {
  const withoutExt = name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  const base = withoutExt
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, config.generatedFiles.maxFilenameChars)
    .trim();
  return `${base || 'export'}.${ext}`;
}

export async function buildGeneratedFile(req: GenerateRequest): Promise<{ buffer: Buffer; mimeType: string; ext: 'xlsx' | 'pdf' }> {
  if (req.format === 'xlsx') return { buffer: await buildXlsx(req.sheets), mimeType: XLSX_MIME, ext: 'xlsx' };
  return { buffer: await buildPdf(req.title, req.content), mimeType: PDF_MIME, ext: 'pdf' };
}
