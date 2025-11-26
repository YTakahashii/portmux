import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { trimLogFile, trimLogFileSync } from './log-writer.js';

describe('LogWriter', () => {
  it('trims the log when exceeding the max size while preserving the tail (async)', async () => {
    const testTmpDir = mkdtempSync(join(tmpdir(), 'portmux-log-writer-'));
    const logPath = join(testTmpDir, 'log.log');

    writeFileSync(logPath, 'a'.repeat(80) + 'b'.repeat(80));
    await trimLogFile(logPath, 100, 0.5);

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toBe('b'.repeat(50));

    rmSync(testTmpDir, { recursive: true, force: true });
  });

  it('trims the log synchronously when exceeding the max size', () => {
    const testTmpDir = mkdtempSync(join(tmpdir(), 'portmux-log-writer-'));
    const logPath = join(testTmpDir, 'log.log');

    writeFileSync(logPath, 'x'.repeat(30));
    trimLogFileSync(logPath, 20, 0.5);

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toBe('x'.repeat(10));

    rmSync(testTmpDir, { recursive: true, force: true });
  });
});
