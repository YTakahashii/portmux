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
  it('kill が成功すれば true を返す', async () => {
    const { isPidAlive } = await importModule();

    expect(isPidAlive(1234)).toBe(true);
    expect(killMock).toHaveBeenCalledWith(1234, 0);
  });

  it('kill が失敗すれば false を返す', async () => {
    killMock.mockImplementation(() => {
      throw new Error('no such process');
    });
    const { isPidAlive } = await importModule();

    expect(isPidAlive(4321)).toBe(false);
  });
});

describe('getCommandLine', () => {
  it('Linux では /proc からコマンドラインを取得する', async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('node\0app.js\0');

    const { getCommandLine } = await importModule();

    expect(getCommandLine(42)).toBe('node app.js');
    expect(existsSyncMock).toHaveBeenCalledWith('/proc/42/cmdline');
    expect(readFileSyncMock).toHaveBeenCalledWith('/proc/42/cmdline', 'utf-8');
  });

  it('Linux で /proc が存在しない場合は null を返す', async () => {
    existsSyncMock.mockReturnValue(false);

    const { getCommandLine } = await importModule();

    expect(getCommandLine(101)).toBeNull();
  });

  it('macOS では ps コマンドの結果を返す', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('node app.js\n');

    const { getCommandLine } = await importModule();

    expect(getCommandLine(7)).toBe('node app.js');
    expect(execSyncMock).toHaveBeenCalledWith('ps -p 7 -o command=', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('Windows ではヘッダーを除いたコマンドラインを返す', async () => {
    platformMock.mockReturnValue('win32');
    execSyncMock.mockReturnValue('CommandLine\r\nnode app.js\r\n');

    const { getCommandLine } = await importModule();

    expect(getCommandLine(99)).toBe('node app.js');
    expect(execSyncMock).toHaveBeenCalledWith('wmic process where ProcessId=99 get CommandLine', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('コマンド取得に失敗した場合は null を返す', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockImplementation(() => {
      throw new Error('ps failed');
    });

    const { getCommandLine } = await importModule();

    expect(getCommandLine(1)).toBeNull();
  });
});

describe('verifyPidCommand', () => {
  it('実際のコマンドラインが期待値を含む場合に true を返す', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('node api-server.js');

    const { verifyPidCommand } = await importModule();

    expect(verifyPidCommand(3000, 'node api-server.js')).toBe(true);
  });

  it('シェル経由で部分一致する場合でも true を返す', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('sh -c "node api-server.js"');

    const { verifyPidCommand } = await importModule();

    expect(verifyPidCommand(4000, 'node api-server.js')).toBe(true);
  });

  it('コマンドが取得できない場合は false を返す', async () => {
    existsSyncMock.mockReturnValue(false);

    const { verifyPidCommand } = await importModule();

    expect(verifyPidCommand(5000, 'node api-server.js')).toBe(false);
  });
});

describe('isPidAliveAndValid', () => {
  it('PID が生存していない場合は false を返す', async () => {
    killMock.mockImplementation(() => {
      throw new Error('not alive');
    });
    const { isPidAliveAndValid } = await importModule();

    expect(isPidAliveAndValid(6000, 'node x.js')).toBe(false);
  });

  it('期待コマンドが指定されない場合は生存確認のみで判定する', async () => {
    const { isPidAliveAndValid } = await importModule();

    expect(isPidAliveAndValid(7000)).toBe(true);
  });

  it('コマンドが一致しない場合は false を返す', async () => {
    platformMock.mockReturnValue('darwin');
    execSyncMock.mockReturnValue('node other.js');

    const { isPidAliveAndValid } = await importModule();

    expect(isPidAliveAndValid(8000, 'node target.js')).toBe(false);
  });
});
