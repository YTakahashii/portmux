import { beforeEach, describe, expect, it, vi } from 'vitest';

const killMock = vi.fn();
const execSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
const platformMock = vi.fn();

vi.mock('process', () => ({ kill: killMock }));
vi.mock('child_process', () => ({ execSync: execSyncMock }));
vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));
vi.mock('os', () => ({ platform: platformMock }));

const importModule = async () => import('./pid-checker.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  platformMock.mockReturnValue('linux');
});

describe('isPidAlive', () => {
  it('returns true when kill succeeds', async () => {
    const { isPidAlive } = await importModule();

    expect(isPidAlive(1234)).toBe(true);
    expect(killMock).toHaveBeenCalledWith(1234, 0);
  });

  it('returns false when kill fails', async () => {
    killMock.mockImplementation(() => {
      throw new Error('no such process');
    });
    const { isPidAlive } = await importModule();

    expect(isPidAlive(4321)).toBe(false);
  });
});

describe('getCommandLine', () => {
  it('reads the command line from /proc on Linux', async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('node\0app.js\0');

    const { getCommandLine } = await importModule();

    expect(getCommandLine(42)).toBe('node app.js');
    expect(existsSyncMock).toHaveBeenCalledWith('/proc/42/cmdline');
    expect(readFileSyncMock).toHaveBeenCalledWith('/proc/42/cmdline', 'utf-8');
  });

  it('returns null when /proc is missing on Linux', async () => {
    existsSyncMock.mockReturnValue(false);

    const { getCommandLine } = await importModule();

    expect(getCommandLine(101)).toBeNull();
  });

  it('uses the ps command result on macOS', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('node app.js\n');

    const { getCommandLine } = await importModule();

    expect(getCommandLine(7)).toBe('node app.js');
    expect(execSyncMock).toHaveBeenCalledWith('ps -p 7 -o command=', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('returns the command line without the header on Windows', async () => {
    platformMock.mockReturnValue('win32');
    execSyncMock.mockReturnValue('CommandLine\r\nnode app.js\r\n');

    const { getCommandLine } = await importModule();

    expect(getCommandLine(99)).toBe('node app.js');
    expect(execSyncMock).toHaveBeenCalledWith('wmic process where ProcessId=99 get CommandLine', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('returns null when command retrieval fails', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockImplementation(() => {
      throw new Error('ps failed');
    });

    const { getCommandLine } = await importModule();

    expect(getCommandLine(1)).toBeNull();
  });
});

describe('verifyPidCommand', () => {
  it('returns true when the actual command line contains the expectation', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('node api-server.js');

    const { verifyPidCommand } = await importModule();

    expect(verifyPidCommand(3000, 'node api-server.js')).toBe(true);
  });

  it('returns true even when the command matches via a shell wrapper', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('sh -c "node api-server.js"');

    const { verifyPidCommand } = await importModule();

    expect(verifyPidCommand(4000, 'node api-server.js')).toBe(true);
  });

  it('returns false when the command cannot be read', async () => {
    existsSyncMock.mockReturnValue(false);

    const { verifyPidCommand } = await importModule();

    expect(verifyPidCommand(5000, 'node api-server.js')).toBe(false);
  });
});

describe('isPidAliveAndValid', () => {
  it('returns false when the PID is not alive', async () => {
    killMock.mockImplementation(() => {
      throw new Error('not alive');
    });
    const { isPidAliveAndValid } = await importModule();

    expect(isPidAliveAndValid(6000, 'node x.js')).toBe(false);
  });

  it('falls back to only the liveness check when no expected command is provided', async () => {
    const { isPidAliveAndValid } = await importModule();

    expect(isPidAliveAndValid(7000)).toBe(true);
  });

  it('returns false when the command does not match', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('node other.js');

    const { isPidAliveAndValid } = await importModule();

    expect(isPidAliveAndValid(8000, 'node target.js')).toBe(false);
  });
});
