import { validateGenerateRequest, sanitizeGenerateRequest, generatedFilename, type GenerateRequest } from '@/lib/generate-file';

const sheet = (rows: unknown[][], columns = ['A', 'B'], name = 'Data') => ({ name, columns, rows });
const xlsx = (sheets: unknown[]) => ({ format: 'xlsx', filename: 'report', sheets });
const error = (input: unknown) => {
  const result = validateGenerateRequest(input);
  if (result.ok) throw new Error('expected a validation error');
  return result.error;
};

describe('validateGenerateRequest', () => {
  it('rejects an unknown format', () => {
    expect(error({ format: 'docx', filename: 'x' })).toMatch(/xlsx.*pdf/);
  });

  it('rejects xlsx without sheets', () => {
    expect(error({ format: 'xlsx', filename: 'x' })).toMatch(/sheets/);
    expect(error(xlsx([]))).toMatch(/sheets/);
  });

  it('rejects more than 10 sheets', () => {
    const sheets = Array.from({ length: 11 }, (_, i) => sheet([[1, 2]], ['A', 'B'], `S${i}`));
    expect(error(xlsx(sheets))).toMatch(/10/);
  });

  it('rejects more than 5000 rows in a sheet', () => {
    const rows = Array.from({ length: 5001 }, () => [1, 2]);
    expect(error(xlsx([sheet(rows)]))).toMatch(/5000|5,000/);
  });

  it('rejects more than 50 columns', () => {
    const columns = Array.from({ length: 51 }, (_, i) => `C${i}`);
    expect(error(xlsx([sheet([], columns)]))).toMatch(/50/);
  });

  it('rejects more than 100000 cells in total', () => {
    const columns = Array.from({ length: 50 }, (_, i) => `C${i}`);
    const rows = Array.from({ length: 2001 }, () => columns.map(() => 1));
    expect(error(xlsx([sheet(rows, columns)]))).toMatch(/100000|100,000/);
  });

  it('rejects non-scalar cells, naming the sheet and row', () => {
    const message = error(xlsx([sheet([[{ a: 1 }, 2]], ['A', 'B'], 'People')]));
    expect(message).toMatch(/People/);
    expect(message).toMatch(/row 1\b/);
  });

  it('rejects a row longer than the columns', () => {
    expect(error(xlsx([sheet([[1, 2, 3]])]))).toMatch(/row 1\b/);
  });

  it('rejects a cell over 32767 characters', () => {
    expect(error(xlsx([sheet([['x'.repeat(32768), 1]])]))).toMatch(/32767|32,767/);
  });

  it('rejects pdf content over 200000 characters', () => {
    expect(error({ format: 'pdf', filename: 'x', content: 'x'.repeat(200001) })).toMatch(/200000|200,000/);
  });

  it('rejects pdf without content', () => {
    expect(error({ format: 'pdf', filename: 'x' })).toMatch(/content/);
  });

  it('accepts a valid xlsx and pdf request', () => {
    expect(validateGenerateRequest(xlsx([sheet([[1, 'two'], [null, true]])])).ok).toBe(true);
    expect(validateGenerateRequest({ format: 'pdf', filename: 'x', title: 'T', content: '# Hi' }).ok).toBe(true);
  });
});

describe('sanitizeGenerateRequest', () => {
  it('strips source references from every string in a workbook, leaving numbers alone', () => {
    const req: GenerateRequest = {
      format: 'xlsx',
      filename: 'r',
      sheets: [{ name: 'From Bar.php', columns: ['see src/Foo/Bar.php'], rows: [['in Bar.php', 42] as never] }],
    };
    const out = JSON.stringify(sanitizeGenerateRequest(req));
    expect(out).not.toMatch(/Bar\.php/);
    expect(out).toMatch(/42/);
  });

  it('strips source references from the pdf title and markdown', () => {
    const out = sanitizeGenerateRequest({ format: 'pdf', filename: 'r', title: 'About Bar.php', content: 'See src/Foo/Bar.php:12 for it' });
    expect(JSON.stringify(out)).not.toMatch(/Bar\.php/);
  });
});

describe('generatedFilename', () => {
  it('makes a hostile name safe for disk and headers', () => {
    const name = generatedFilename('Q3 "report"\n/x', 'xlsx');
    expect(name).toMatch(/^[A-Za-z0-9 ._-]+\.xlsx$/);
  });

  it('falls back to export when nothing is left', () => {
    expect(generatedFilename('', 'pdf')).toBe('export.pdf');
    expect(generatedFilename('"""', 'pdf')).toBe('export.pdf');
  });

  it('caps the length and keeps the extension', () => {
    const name = generatedFilename('a'.repeat(300), 'pdf');
    expect(name.length).toBeLessThanOrEqual(105);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('does not double the extension', () => {
    expect(generatedFilename('report.xlsx', 'xlsx')).toBe('report.xlsx');
    expect(generatedFilename('report.PDF', 'pdf')).toBe('report.pdf');
  });
});

describe('review fixes', () => {
  it('keeps nested list indentation in pdf markdown while stripping paths', () => {
    const out = sanitizeGenerateRequest({ format: 'pdf', filename: 'r', content: '1. Step one\n   - sub a in src/A/B.php\n2. Step two' });
    expect(out.format === 'pdf' && out.content).toBe('1. Step one\n   - sub a in\n2. Step two');
  });

  it('keeps accented letters in filenames', () => {
    expect(generatedFilename('Overzicht categorieën', 'xlsx')).toBe('Overzicht categorieen.xlsx');
    expect(generatedFilename('Résumé', 'pdf')).toBe('Resume.pdf');
  });

  it('strips source file names from the filename', () => {
    const out = sanitizeGenerateRequest({ format: 'xlsx', filename: 'UserController.php export', sheets: [{ name: 'S', columns: ['a'], rows: [] }] });
    expect(out.filename).not.toMatch(/\.php/);
  });
});
