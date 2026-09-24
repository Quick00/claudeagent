import { stripSourceReferences } from '@/lib/sanitize-response';

describe('stripSourceReferences', () => {
  it('strips a path with a line number', () => {
    expect(stripSourceReferences('See src/Checkin/Validator.php:69 for details.')).toBe('See for details.');
  });

  it('strips a bare source file name without a folder', () => {
    // A note between tool calls: `"SessionTagLimit.php" — exactly what we need.`
    expect(stripSourceReferences('Found SessionTagLimit.php, which sets the limit.')).toBe('Found , which sets the limit.');
    expect(stripSourceReferences('The Badge.tsx screen shows it.')).toBe('The screen shows it.');
  });

  it('drops the quotes a stripped file name leaves behind', () => {
    expect(stripSourceReferences('"SessionTagLimit.php" — exactly what we need.')).toBe(' — exactly what we need.');
    expect(stripSourceReferences('“SessionTagLimit.php” — exactly what we need.')).toBe(' — exactly what we need.');
  });

  it('leaves ordinary sentences with dots alone', () => {
    const text = 'Version 2.5 is live, e.g. for events on example.com. Price is 3.50.';
    expect(stripSourceReferences(text)).toBe(text);
  });
});
