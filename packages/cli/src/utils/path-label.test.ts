import { describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join, sep } from 'path';
import { shortenHomePath } from './path-label.js';

describe('shortenHomePath', () => {
  it('replaces the home prefix with tilde for nested paths', () => {
    const home = homedir();
    const nestedPath = join(home, 'projects', 'app');
    expect(shortenHomePath(nestedPath)).toBe(`~${nestedPath.slice(home.length)}`);
  });

  it('returns tilde for the home directory itself', () => {
    const home = homedir();
    expect(shortenHomePath(home)).toBe('~');
  });

  it('returns the original path when outside the home', () => {
    const outsidePath = join(sep, 'var', 'app');
    expect(shortenHomePath(outsidePath)).toBe(outsidePath);
  });
});
