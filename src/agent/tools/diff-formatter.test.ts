import { describe, it, expect } from 'bun:test';
import { generatePatch, formatPatchToText } from './diff-formatter.js';

describe('diff-formatter', () => {
  describe('generatePatch', () => {
    it('returns non-empty hunks for normal replacement', () => {
      const oldContent = 'hello world\nfoo bar\n';
      const newContent = 'hello world\nbaz qux\n';
      const hunks = generatePatch('test.txt', oldContent, newContent);
      expect(hunks.length).toBeGreaterThan(0);
    });

    it('returns [] for identical content', () => {
      const content = 'same content\n';
      const hunks = generatePatch('test.txt', content, content);
      expect(hunks).toEqual([]);
    });

    it('preserves & characters (workaround test)', () => {
      const oldContent = 'foo & bar\n';
      const newContent = 'foo & baz\n';
      const hunks = generatePatch('test.txt', oldContent, newContent);
      expect(hunks.length).toBeGreaterThan(0);
      const text = formatPatchToText('test.txt', hunks);
      expect(text).toContain('&');
      expect(text).not.toContain('AMPERSAND_TOKEN');
    });

    it('preserves $ characters (workaround test)', () => {
      const oldContent = 'foo $ bar\n';
      const newContent = 'foo $ baz\n';
      const hunks = generatePatch('test.txt', oldContent, newContent);
      expect(hunks.length).toBeGreaterThan(0);
      const text = formatPatchToText('test.txt', hunks);
      expect(text).toContain('$');
      expect(text).not.toContain('DOLLAR_TOKEN');
    });
  });

  describe('formatPatchToText', () => {
    it('outputs standard diff format', () => {
      const oldContent = 'line1\nline2\nline3\n';
      const newContent = 'line1\nmodified\nline3\n';
      const hunks = generatePatch('test.txt', oldContent, newContent);
      const text = formatPatchToText('test.txt', hunks);
      expect(text).toContain('--- a/test.txt');
      expect(text).toContain('+++ b/test.txt');
      expect(text).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
      expect(text).toContain('-line2');
      expect(text).toContain('+modified');
    });

    it('returns "" for empty array', () => {
      const text = formatPatchToText('test.txt', []);
      expect(text).toBe('');
    });
  });
});
