import { validateMagicBytes, getExtensionFromMime, sanitizeFilename } from '@/lib/upload';

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

    it('returns null for unsupported mime', () => {
      expect(getExtensionFromMime('application/pdf')).toBeNull();
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
});
