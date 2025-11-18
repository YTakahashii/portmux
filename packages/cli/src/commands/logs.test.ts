import { StateManager } from '@portmux/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runLogsCommand } from './logs.js';

vi.mock('@portmux/core', () => ({
  StateManager: {
    readState: vi.fn(),
  },
}));

vi.mock('chalk', () => ({
  default: {
    red: (msg: string) => msg,
  },
}));

describe('runLogsCommand', () => {
  const readState = vi.mocked(StateManager.readState);
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'portmux-logs-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits with error when state is not found', async () => {
    readState.mockReturnValue(null);

    await runLogsCommand('workspace', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith('エラー: ワークスペース "workspace" のプロセス "proc" は実行中ではありません');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when logPath is missing', async () => {
    readState.mockReturnValue({
      workspace: 'workspace',
      process: 'proc',
      status: 'Running' as const,
    });

    await runLogsCommand('workspace', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "proc" のログファイルパスが見つかりません');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when log file does not exist', async () => {
    const logPath = join(tempDir, 'missing.log');
    readState.mockReturnValue({
      workspace: 'workspace',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    await runLogsCommand('workspace', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith(`エラー: ログファイルが存在しません: ${logPath}`);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('prints tail lines without following', async () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, ['line1', 'line2', 'line3'].join('\n'));
    readState.mockReturnValue({
      workspace: 'workspace',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    await runLogsCommand('workspace', 'proc', { lines: '2', follow: false, timestamps: false });

    expect(console.log).toHaveBeenCalledWith('line2');
    expect(console.log).toHaveBeenCalledWith('line3');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('adds timestamps when requested', async () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, 'only-line\n');
    readState.mockReturnValue({
      workspace: 'workspace',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    await runLogsCommand('workspace', 'proc', { lines: '1', follow: false, timestamps: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T/));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('rejects invalid line count', async () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, 'line\n');
    readState.mockReturnValue({
      workspace: 'workspace',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    await runLogsCommand('workspace', 'proc', { lines: 'abc', follow: false });

    expect(console.error).toHaveBeenCalledWith('エラー: --lines には 0 以上の整数を指定してください');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
