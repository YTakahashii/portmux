import { StateManager } from '@portmux/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runLogsCommand } from './logs.js';

let logDir: string;
vi.mock('@portmux/core', () => ({
  StateManager: {
    listAllStates: vi.fn(),
  },
  getLogDir: () => logDir,
}));

vi.mock('chalk', () => ({
  default: {
    red: (msg: string) => msg,
    yellow: (msg: string) => msg,
  },
}));

describe('runLogsCommand', () => {
  const listAllStates = vi.mocked(StateManager.listAllStates);
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'portmux-logs-test-'));
    logDir = tempDir;
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
    expect(console.log).toHaveBeenCalledWith('  - ws (/repo/path)/api');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when state is not found', () => {
    listAllStates.mockReturnValue([]);

    runLogsCommand('group', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: Group "group" is not running');
    expect(console.log).toHaveBeenCalledWith('No running processes');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when logPath is missing', () => {
    listAllStates.mockReturnValue([{ group: 'group', process: 'proc', status: 'Running' as const }]);

    runLogsCommand('group', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: Log file path for process "proc" was not found');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with error when log file does not exist', () => {
    const logPath = join(tempDir, 'missing.log');
    listAllStates.mockReturnValue([{ group: 'group', process: 'proc', status: 'Running' as const, logPath }]);

    runLogsCommand('group', 'proc', { follow: false });

    expect(console.error).toHaveBeenCalledWith(`Error: Log file does not exist: ${logPath}`);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('prints tail lines without following', () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, ['line1', 'line2', 'line3'].join('\n'));
    listAllStates.mockReturnValue([{ group: 'group', process: 'proc', status: 'Running' as const, logPath }]);

    runLogsCommand('group', 'proc', { lines: '2', follow: false, timestamps: false });

    expect(console.log).toHaveBeenCalledWith('line2');
    expect(console.log).toHaveBeenCalledWith('line3');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('adds timestamps when requested', () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, 'only-line\n');
    listAllStates.mockReturnValue([{ group: 'group', process: 'proc', status: 'Running' as const, logPath }]);

    runLogsCommand('group', 'proc', { lines: '1', follow: false, timestamps: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T/));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('rejects invalid line count', () => {
    const logPath = join(tempDir, 'app.log');
    writeFileSync(logPath, 'line\n');
    listAllStates.mockReturnValue([{ group: 'group', process: 'proc', status: 'Running' as const, logPath }]);

    runLogsCommand('group', 'proc', { lines: 'abc', follow: false });

    expect(console.error).toHaveBeenCalledWith('Error: --lines must be an integer greater than or equal to 0');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
