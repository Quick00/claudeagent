import ExcelJS from 'exceljs';
import type { SheetInput } from '@/lib/generate-file';

const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

/** Excel sheet names: 1-31 chars, none of \ / ? * [ ] :, unique ignoring case. */
function sheetNames(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((name, i) => {
    const base = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet ${i + 1}`;
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function buildXlsx(sheets: SheetInput[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const names = sheetNames(sheets.map((s) => s.name));

  sheets.forEach((sheet, i) => {
    const ws = workbook.addWorksheet(names[i], { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(sheet.columns).font = { bold: true };
    // Plain values only: a string is stored as text, so "=SUM(...)" never becomes a formula.
    for (const row of sheet.rows) ws.addRow(row.map((cell) => cell ?? null));

    sheet.columns.forEach((column, c) => {
      const longest = Math.max(column.length, ...sheet.rows.map((row) => String(row[c] ?? '').length));
      ws.getColumn(c + 1).width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
