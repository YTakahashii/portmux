import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LogWriter } from './log-writer.js';

describe('LogWriter', () => {
  it('trims the log when exceeding the max size while preserving the tail', async () => {
    const testTmpDir = mkdtempSync(join(tmpdir(), 'portmux-log-writer-'));
    const logPath = join(testTmpDir, 'log.log');
    const writer = await LogWriter.create(logPath, 100, 0.5);

    await writer.write('a'.repeat(80));
    await writer.write('b'.repeat(80));
    await writer.close();

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toBe('b'.repeat(50));

    rmSync(testTmpDir, { recursive: true, force: true });
  });
});
