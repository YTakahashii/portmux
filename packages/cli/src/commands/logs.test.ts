import { StateManager } from '@portmux/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runLogsCommand } from './logs.js';

vi.mock('@portmux/core', () => ({
  StateManager: {
    readState: vi.fn(),
    listAllStates: vi.fn(),
  },
}));

vi.mock('chalk', () => ({
  default: {
    red: (msg: string) => msg,
  },
}));

describe('runLogsCommand', () => {
  const readState = vi.mocked(StateManager.readState);
  const listAllStates = vi.mocked(StateManager.listAllStates);
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

  it('prints available processes when group or process is missing', () => {
    listAllStates.mockReturnValue([
      { group: 'ws', groupKey: '/repo/path', process: 'api', status: 'Running' as const },
    ]);

    runLogsCommand(undefined, undefined, { follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: Please provide both group and process names');
    expect(console.log).toHaveBeenCalledWith('Available groups/processes:');
    expect(console.log).toHaveBeenCalledWith('  - /repo/path (ws)/api');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when state is not found', () => {
    readState.mockReturnValue(null);

    runLogsCommand('group', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: Process "proc" in group "group" is not running');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when logPath is missing', () => {
    readState.mockReturnValue({
      group: 'group',
      process: 'proc',
      status: 'Running' as const,
    });

    runLogsCommand('group', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: Log file path for process "proc" was not found');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when log file does not exist', () => {
    const logPath = join(tempDir, 'missing.log');
    readState.mockReturnValue({
      group: 'group',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    runLogsCommand('group', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith(`Error: Log file does not exist: ${logPath}`);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('prints tail lines without following', () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, ['line1', 'line2', 'line3'].join('\n'));
    readState.mockReturnValue({
      group: 'group',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    runLogsCommand('group', 'proc', { lines: '2', follow: false, timestamps: false });

    expect(console.log).toHaveBeenCalledWith('line2');
    expect(console.log).toHaveBeenCalledWith('line3');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('adds timestamps when requested', () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, 'only-line\n');
    readState.mockReturnValue({
      group: 'group',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    runLogsCommand('group', 'proc', { lines: '1', follow: false, timestamps: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T/));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('rejects invalid line count', () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, 'line\n');
    readState.mockReturnValue({
      group: 'group',
      process: 'proc',
      status: 'Running' as const,
      logPath,
    });

    runLogsCommand('group', 'proc', { lines: 'abc', follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: --lines must be an integer greater than or equal to 0');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
