import { LockManager, LockTimeoutError, ProcessManager, ProcessStopError, StateManager } from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runStopCommand } from './stop.js';

vi.mock('@portmux/core', () => {
  class ProcessStopError extends Error {}
  class LockTimeoutError extends Error {}

  return {
    StateManager: {
      listAllStates: vi.fn(),
    },
    LockManager: {
      withLock: vi.fn(),
    },
    ProcessManager: {
      stopProcess: vi.fn(),
    },
    ProcessStopError,
    LockTimeoutError,
  };
});

vi.mock('chalk', () => ({
  default: {
    yellow: (msg: string) => msg,
    green: (msg: string) => msg,
    red: (msg: string) => msg,
  },
}));

describe('stopCommand', () => {
  const listAllStates = vi.mocked(StateManager.listAllStates);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(LockManager.withLock).mockImplementation(async (_scope, _key, fn) => {
      await fn();
    });
    vi.mocked(ProcessManager.stopProcess).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prints message when no processes to stop', async () => {
    listAllStates.mockReturnValue([]);

    await runStopCommand();

    expect(console.log).toHaveBeenCalledWith('停止するプロセスがありません');
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
  });

  it('errors when multiple workspaces are running without specifying workspace', async () => {
    listAllStates.mockReturnValue([
      { workspace: 'ws1', process: 'api', status: 'Running' as const },
      { workspace: 'ws2', process: 'worker', status: 'Running' as const },
    ]);

    await runStopCommand();

    expect(console.error).toHaveBeenCalledWith('エラー: 複数のワークスペースが実行中です。ワークスペース名を指定してください。');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
  });

  it('stops all processes in specified workspace', async () => {
    listAllStates.mockReturnValue([
      { workspace: 'ws1', process: 'api', status: 'Running' as const },
      { workspace: 'ws1', process: 'worker', status: 'Running' as const },
      { workspace: 'ws2', process: 'other', status: 'Running' as const },
    ]);

    await runStopCommand('ws1');

    expect(LockManager.withLock).toHaveBeenCalledWith('workspace', 'ws1', expect.any(Function));
    expect(ProcessManager.stopProcess).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "api" を停止しました');
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "worker" を停止しました');
  });

  it('reports when targeted process is not running', async () => {
    listAllStates.mockReturnValue([{ workspace: 'ws1', process: 'api', status: 'Running' as const }]);

    await runStopCommand('ws1', 'missing');

    expect(console.log).toHaveBeenCalledWith('プロセス "missing" は実行中ではありません');
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
  });

  it('logs ProcessStopError and continues', async () => {
    listAllStates.mockReturnValue([{ workspace: 'ws1', process: 'api', status: 'Running' as const }]);
    vi.mocked(ProcessManager.stopProcess).mockRejectedValueOnce(new ProcessStopError('failed'));

    await runStopCommand('ws1');

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "api" の停止に失敗しました: failed');
  });

  it('exits on lock timeout', async () => {
    listAllStates.mockReturnValue([{ workspace: 'ws1', process: 'api', status: 'Running' as const }]);
    vi.mocked(LockManager.withLock).mockRejectedValueOnce(new LockTimeoutError('timeout'));

    await runStopCommand('ws1');

    expect(console.error).toHaveBeenCalledWith('エラー: timeout');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
