import ExcelJS from 'exceljs';
import { buildXlsx } from '@/lib/generate-xlsx';

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('buildXlsx', () => {
  it('writes a bold header row matching the columns, frozen', async () => {
    const wb = await read(await buildXlsx([{ name: 'People', columns: ['Name', 'Age'], rows: [['Ann', 31]] }]));
    const ws = wb.getWorksheet('People')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Name', 'Age']);
    expect(ws.getRow(1).font?.bold ?? ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('keeps numbers as numbers and booleans as booleans', async () => {
    const wb = await read(await buildXlsx([{ name: 'S', columns: ['n', 'b', 'e'], rows: [[3.5, true, null]] }]));
    const ws = wb.worksheets[0];
    expect(typeof ws.getCell('A2').value).toBe('number');
    expect(ws.getCell('B2').value).toBe(true);
  });

  it('never writes a formula, even for text that looks like one', async () => {
    const wb = await read(await buildXlsx([{ name: 'S', columns: ['f'], rows: [['=SUM(A1)'], ['+1'], ['@cmd']] }]));
    const ws = wb.worksheets[0];
    expect(ws.getCell('A2').formula).toBeUndefined();
    expect(ws.getCell('A2').value).toBe('=SUM(A1)');
    expect(ws.getCell('A3').value).toBe('+1');
  });

  it('makes sheet names valid and unique', async () => {
    const wb = await read(await buildXlsx([
      { name: 'a/b:c*?[]', columns: ['x'], rows: [] },
      { name: 'x'.repeat(40), columns: ['x'], rows: [] },
      { name: 'Data', columns: ['x'], rows: [] },
      { name: 'Data', columns: ['x'], rows: [] },
      { name: '', columns: ['x'], rows: [] },
    ]));
    const names = wb.worksheets.map((w) => w.name);
    for (const n of names) {
      expect(n.length).toBeGreaterThan(0);
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[\\/?*[\]:]/);
    }
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names).toContain('Data');
    expect(names).toContain('Data (2)');
  });

  it('sizes columns to their content within bounds', async () => {
    const wb = await read(await buildXlsx([{ name: 'S', columns: ['a', 'b'], rows: [['x'.repeat(200), 'y']] }]));
    const ws = wb.worksheets[0];
    expect(ws.getColumn(1).width).toBe(60);
    expect(ws.getColumn(2).width).toBe(8);
  });

  it('renames the sheet name Excel reserves', async () => {
    const wb = await read(await buildXlsx([{ name: 'History', columns: ['x'], rows: [] }, { name: 'history', columns: ['x'], rows: [] }]));
    expect(wb.worksheets.map((w) => w.name.toLowerCase())).not.toContain('history');
  });
});
