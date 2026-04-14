/**
 * Strips source code references (file paths, line numbers) from AI responses.
 * Acts as a safety net — the system prompt already forbids these, but Claude
 * sometimes leaks them, especially in resumed sessions.
 */

// Backtick-wrapped file:line references like `CheckInValidator.php:69-72`
const BACKTICK_FILE_LINE = /`[^`]*\.\w{1,5}:\d+(?:-\d+)?`/g;

// Backtick-wrapped path references like `src/Controllers/CheckInValidator.php`
const BACKTICK_PATH = /`[^`]*\/[^`]+\.\w{1,5}`/g;

// Bare file:line references like CheckInValidator.php:69-72 (word boundary)
const BARE_FILE_LINE = /\b[\w/.-]*\w\.\w{1,5}:\d+(?:-\d+)?\b/g;

// Full path references like src/Controllers/Foo.php (must contain a slash)
const BARE_PATH = /\b(?:[\w.-]+\/){1,}[\w.-]+\.\w{1,5}\b/g;

// Parenthetical source references like "(in CheckInValidator.php:69-72)"
const PAREN_SOURCE_REF = /\s*\(in\s+[^)]*\.\w{1,5}(?::\d+(?:-\d+)?)?\s*\)/gi;

const patterns = [
  PAREN_SOURCE_REF,
  BACKTICK_FILE_LINE,
  BACKTICK_PATH,
  BARE_FILE_LINE,
  BARE_PATH,
];

export function stripSourceReferences(text: string): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  // Clean up leftover artifacts
  result = result.replace(/``/g, '');
  result = result.replace(/\s*\(in\s*\)/g, '');
  result = result.replace(/  +/g, ' ');
  return result;
}
