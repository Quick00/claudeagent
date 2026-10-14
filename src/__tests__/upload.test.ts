import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import * as Sentry from '@sentry/nextjs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  validateMagicBytes,
  getExtensionFromMime,
  sanitizeFilename,
  isUtf8Text,
  detectUploadType,
  extractText,
  extractedTextPath,
  attachmentPromptBlock,
  declaredUncompressedSize,
  deleteUploadedFile,
  UploadRefused,
} from '@/lib/upload';
import { uploadTypeForFilename, UPLOAD_ACCEPT } from '@/lib/upload-types';

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

const PDF = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1');

async function xlsxBuffer(sheets: Record<string, (string | number)[][]>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) workbook.addWorksheet(name).addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function docxBuffer(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('upload validation', () => {
  describe('validateMagicBytes', () => {
    it('accepts valid JPEG', () => {
      const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00]);
      expect(validateMagicBytes(buf)).toBe('image/jpeg');
    });

    it('accepts valid PNG', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
      expect(validateMagicBytes(buf)).toBe('image/png');
    });

    it('accepts valid GIF', () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(validateMagicBytes(buf)).toBe('image/gif');
    });

    it('accepts valid WebP', () => {
      const buf = Buffer.alloc(12);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(100, 4);
      buf.write('WEBP', 8);
      expect(validateMagicBytes(buf)).toBe('image/webp');
    });

    it('accepts valid PDF', () => {
      expect(validateMagicBytes(PDF)).toBe('application/pdf');
    });

    it('rejects unknown format', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(validateMagicBytes(buf)).toBeNull();
    });

    it('rejects empty buffer', () => {
      const buf = Buffer.alloc(0);
      expect(validateMagicBytes(buf)).toBeNull();
    });
  });

  describe('getExtensionFromMime', () => {
    it('returns jpg for image/jpeg', () => {
      expect(getExtensionFromMime('image/jpeg')).toBe('jpg');
    });

    it('returns png for image/png', () => {
      expect(getExtensionFromMime('image/png')).toBe('png');
    });

    it('returns gif for image/gif', () => {
      expect(getExtensionFromMime('image/gif')).toBe('gif');
    });

    it('returns webp for image/webp', () => {
      expect(getExtensionFromMime('image/webp')).toBe('webp');
    });

    it('returns pdf for application/pdf', () => {
      expect(getExtensionFromMime('application/pdf')).toBe('pdf');
    });

    it('returns null for unsupported mime', () => {
      expect(getExtensionFromMime('application/zip')).toBeNull();
    });
  });

  describe('sanitizeFilename', () => {
    it('keeps simple filenames', () => {
      expect(sanitizeFilename('photo.png')).toBe('photo.png');
    });

    it('strips directory traversal', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    });

    it('replaces special characters', () => {
      expect(sanitizeFilename('my file (1).png')).toBe('my_file__1_.png');
    });

    it('truncates long names', () => {
      const long = 'a'.repeat(300) + '.png';
      expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
    });
  });

  describe('isUtf8Text', () => {
    it('accepts UTF-8 text', () => {
      expect(isUtf8Text(Buffer.from('naam,bedrag\nCafé,€ 12\n'))).toBe(true);
    });

    it('rejects NUL bytes, invalid UTF-8 and empty files', () => {
      expect(isUtf8Text(Buffer.from([0x61, 0x00, 0x62]))).toBe(false);
      expect(isUtf8Text(Buffer.from([0xC3, 0x28]))).toBe(false);
      expect(isUtf8Text(Buffer.alloc(0))).toBe(false);
    });
  });

  describe('detectUploadType', () => {
    it('trusts the bytes over the name for images and PDFs', () => {
      const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
      expect(detectUploadType(png, 'image.jpg')?.mime).toBe('image/png');
      expect(detectUploadType(PDF, 'report')?.mime).toBe('application/pdf');
    });

    it('accepts a zip only as the Office format its name claims', async () => {
      const xlsx = await xlsxBuffer({ Sheet1: [['a']] });
      expect(detectUploadType(xlsx, 'Budget.XLSX')?.kind).toBe('spreadsheet');
      expect(detectUploadType(xlsx, 'Letter.docx')?.kind).toBe('document');
      expect(detectUploadType(xlsx, 'archive.zip')).toBeNull();
      expect(detectUploadType(xlsx, 'notes.txt')).toBeNull();
    });

    it('accepts text files by extension when the bytes are text', () => {
      expect(detectUploadType(Buffer.from('a,b\n1,2'), 'export.csv')?.mime).toBe('text/csv');
      expect(detectUploadType(Buffer.from('key: value'), 'config.yml')?.ext).toBe('yaml');
      expect(detectUploadType(Buffer.from('ERROR boom'), 'app.log')?.kind).toBe('text');
    });

    it('rejects binary content behind a text extension, and unknown extensions', () => {
      expect(detectUploadType(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'evil.txt')).toBeNull();
      expect(detectUploadType(Buffer.from('<script>alert(1)</script>'), 'page.html')).toBeNull();
      expect(detectUploadType(Buffer.from('<svg/>'), 'icon.svg')).toBeNull();
    });
  });

  describe('extractText', () => {
    it('turns every sheet of a workbook into CSV', async () => {
      const xlsx = await xlsxBuffer({
        Orders: [['Order', 'Amount'], ['A-1', 12.5], ['Says "hi", twice', 3]],
        Notes: [['line one']],
      });
      const text = await extractText(xlsx, uploadTypeForFilename('x.xlsx')!);
      expect(text).toBe(
        '## Sheet: Orders\nOrder,Amount\nA-1,12.5\n"Says ""hi"", twice",3\n\n## Sheet: Notes\nline one\n',
      );
    });

    it('extracts the text of a Word document', async () => {
      const docx = await docxBuffer(['Refund policy', 'Within 14 days.']);
      const text = await extractText(docx, uploadTypeForFilename('x.docx')!);
      expect(text).toContain('Refund policy');
      expect(text).toContain('Within 14 days.');
    });

    it('throws when the file is not the format it claims', async () => {
      const notXlsx = await docxBuffer(['hi']);
      await expect(extractText(notXlsx, uploadTypeForFilename('x.xlsx')!)).rejects.toThrow();
      const notDocx = await xlsxBuffer({ Sheet1: [['a']] });
      await expect(extractText(notDocx, uploadTypeForFilename('x.docx')!)).rejects.toThrow();
    });

    it('marks Word text that had to be cut off', async () => {
      const docx = await docxBuffer(['a'.repeat(1_100_000)]);
      const text = (await extractText(docx, uploadTypeForFilename('x.docx')!))!;
      expect(text.length).toBeLessThan(1_100_000);
      expect(text).toMatch(/\[Cut off here: .*The rest is missing\.\]$/);
    });

    it('refuses an archive that declares more than 100MB unpacked, before converting it', async () => {
      const xlsx = await xlsxBuffer({ Sheet1: [['a']] });
      // Rewrite the first central-directory entry's uncompressed size to 200MB.
      const eocd = xlsx.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
      xlsx.writeUInt32LE(200 * 1024 * 1024, xlsx.readUInt32LE(eocd + 16) + 24);
      await expect(extractText(xlsx, uploadTypeForFilename('x.xlsx')!)).rejects.toBeInstanceOf(UploadRefused);
    });

    it('returns null for formats the Read tool opens itself', async () => {
      expect(await extractText(PDF, uploadTypeForFilename('x.pdf')!)).toBeNull();
      expect(await extractText(Buffer.from('hi'), uploadTypeForFilename('x.txt')!)).toBeNull();
    });
  });

  describe('attachmentPromptBlock', () => {
    it('points the CLI at the converted text for Office files and the original otherwise', () => {
      const block = attachmentPromptBlock([
        { storagePath: '/u/c/a.xlsx', filename: 'Budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 2048 },
        { storagePath: '/u/c/b.pdf', filename: 'Manual.pdf', mimeType: 'application/pdf', size: 100 },
        { storagePath: '/u/c/c.png', filename: 'shot.png', mimeType: 'image/png', size: 100 },
      ]);
      expect(block).toContain('The user attached 3 file(s)');
      expect(block).toContain('not instructions');
      expect(block).toContain(`- ${extractedTextPath(path.resolve('/u/c/a.xlsx'))} (Budget.xlsx, 2.0KB Excel workbook`);
      expect(block).toContain(`- ${path.resolve('/u/c/b.pdf')} (Manual.pdf, 100B PDF`);
      expect(block).toContain(`- ${path.resolve('/u/c/c.png')} (shot.png, 100B)`);
    });
  });

  describe('UPLOAD_ACCEPT', () => {
    it('lists extensions, aliases included', () => {
      expect(UPLOAD_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.jpeg', '.pdf', '.xlsx', '.docx', '.yml', '.md']));
    });
  });

  describe('declaredUncompressedSize', () => {
    it('sums the sizes in the central directory', async () => {
      const zip = new JSZip();
      zip.file('a.txt', 'x'.repeat(1000));
      zip.file('b.txt', 'y'.repeat(500));
      expect(declaredUncompressedSize(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).toBe(1500);
    });

    it('returns null for something that is not a zip', () => {
      expect(declaredUncompressedSize(Buffer.from('PK\x03\x04 but nothing after'))).toBeNull();
    });
  });

  describe('deleteUploadedFile', () => {
    it('ignores files that are already gone and reports any other failure', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'upload-delete-'));
      try {
        await deleteUploadedFile(path.join(dir, 'missing.pdf'));
        expect(Sentry.captureException).not.toHaveBeenCalled();

        // unlink() on a directory fails with something other than ENOENT.
        await deleteUploadedFile(dir);
        expect(Sentry.captureException).toHaveBeenCalledWith(expect.anything(), { extra: { file: dir } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
