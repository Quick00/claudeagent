import { buildPdf, markdownToPdfContent } from '@/lib/generate-pdf';

const flat = (v: unknown) => JSON.stringify(v);

type Node = {
  style?: string;
  table?: { headerRows: number; body: unknown[][] };
  ul?: unknown[];
  ol?: unknown[];
  start?: number;
};
const nodesOf = (markdown: string) => markdownToPdfContent(markdown) as Node[];

describe('markdownToPdfContent', () => {
  it('maps a heading to a styled node', () => {
    const [node] = nodesOf('# Overview');
    expect(node.style).toBe('h1');
    expect(flat(node)).toMatch(/Overview/);
  });

  it('maps a table to a pdfmake table with a header row', () => {
    const nodes = nodesOf('| Name | Age |\n|---|---|\n| Ann | 31 |\n| Bob | 40 |');
    const table = nodes.find((n) => n.table)!;
    expect(table.table!.headerRows).toBe(1);
    expect(table.table!.body).toHaveLength(3);
    expect(table.table!.body[0]).toHaveLength(2);
    expect(flat(table.table!.body[2])).toMatch(/Bob/);
  });

  it('maps bullet and numbered lists', () => {
    const nodes = nodesOf('- a\n- b\n\n1. one\n2. two');
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
    const nodes = nodesOf('1. one\n2. two\n\nA paragraph.\n\n3. three');
    const lists = nodes.filter((n) => n.ol);
    expect(lists[1].start).toBe(3);
  });

  // Wall-clock limits are flaky on shared CI runners, so each worst case is timed against plain
  // text of the same size in the same run. Before the fix these were ~100x slower than plain.
  async function timed(markdown: string) {
    const started = Date.now();
    await buildPdf(undefined, markdown);
    return Date.now() - started;
  }

  it('lays out a single huge word no slower than plain text', async () => {
    const plain = await timed('a '.repeat(50000));
    expect(await timed('x'.repeat(200000))).toBeLessThan(plain * 3 + 500);
  }, 60000);

  it('lays out heavily formatted text no slower than plain text', async () => {
    const plain = await timed('a '.repeat(50000));
    expect(await timed('*a* '.repeat(50000))).toBeLessThan(plain * 3 + 500);
  }, 60000);
});
