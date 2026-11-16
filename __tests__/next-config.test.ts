import { readFileSync } from 'fs';
import path from 'path';

// Jest never bundles, so only this catches it: once Next bundles pdfkit, its
// "#standard-fonts/..." imports fail and every PDF request returns an error.
test('pdfmake and pdfkit stay out of the server bundle', () => {
  const source = readFileSync(path.join(__dirname, '..', 'next.config.ts'), 'utf8');
  const match = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(source);
  expect(match?.[1]).toMatch(/"pdfmake"/);
  expect(match?.[1]).toMatch(/"pdfkit"/);
});
