import { buildPdf, markdownToPdfContent } from '@/lib/generate-pdf';

const flat = (v: unknown) => JSON.stringify(v);

describe('markdownToPdfContent', () => {
  it('maps a heading to a styled node', () => {
    const [node] = markdownToPdfContent('# Overview') as Array<Record<string, unknown>>;
    expect(node.style).toBe('h1');
    expect(flat(node)).toMatch(/Overview/);
  });

  it('maps a table to a pdfmake table with a header row', () => {
    const nodes = markdownToPdfContent('| Name | Age |\n|---|---|\n| Ann | 31 |\n| Bob | 40 |') as Array<Record<string, any>>;
    const table = nodes.find((n) => n.table)!;
    expect(table.table.headerRows).toBe(1);
    expect(table.table.body).toHaveLength(3);
    expect(table.table.body[0]).toHaveLength(2);
    expect(flat(table.table.body[2])).toMatch(/Bob/);
  });

  it('maps bullet and numbered lists', () => {
    const nodes = markdownToPdfContent('- a\n- b\n\n1. one\n2. two') as Array<Record<string, any>>;
    expect(nodes.find((n) => n.ul)?.ul).toHaveLength(2);
    expect(nodes.find((n) => n.ol)?.ol).toHaveLength(2);
  });

  it('marks bold and italic runs', () => {
    const out = flat(markdownToPdfContent('Some **strong** and *soft* text'));
    expect(out).toMatch(/"text":"strong","bold":true|"bold":true,"text":"strong"/);
    expect(out).toMatch(/"italics":true/);
  });

  it('never emits images or links that pdfmake would fetch', () => {
    const out = flat(markdownToPdfContent('![x](http://evil/x.png) [site](http://example.com)'));
    expect(out).not.toMatch(/"image"/);
    expect(out).not.toMatch(/"link"/);
  });
});

describe('buildPdf', () => {
  it('produces a PDF', async () => {
    const buffer = await buildPdf('Report', '# Hi\n\nHello **there**.');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('survives unsupported nodes', async () => {
    const md = '```js\nconst x = 1;\n```\n\n<div>html</div>\n\n![img](x.png)\n\n- a\n  - nested\n    - deeper\n\n> quote\n\n---';
    const buffer = await buildPdf(undefined, md);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles characters outside plain ASCII', async () => {
    const buffer = await buildPdf('Café €5 “quoted”', 'Ünïcode — dash ✓ 日本');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('review fixes', () => {
  it('keeps a numbered list numbered after an interruption', () => {
    const nodes = markdownToPdfContent('1. one\n2. two\n\nA paragraph.\n\n3. three') as Array<Record<string, any>>;
    const lists = nodes.filter((n) => n.ol);
    expect(lists[1].start).toBe(3);
  });

  it('builds a pathological single long word quickly', async () => {
    const started = Date.now();
    await buildPdf(undefined, 'x'.repeat(200000));
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('builds heavily formatted text quickly', async () => {
    const started = Date.now();
    await buildPdf(undefined, '*a* '.repeat(50000));
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
