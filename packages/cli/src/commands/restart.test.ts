import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  ProcessManager,
  ProcessStartError,
  ProcessStopError,
  StateManager,
  WorkspaceManager,
} from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runRestartCommand } from './restart.js';

vi.mock('@portmux/core', () => {
  class ConfigNotFoundError extends Error {}
  class WorkspaceResolutionError extends Error {}
  class ProcessStopError extends Error {}
  class ProcessStartError extends Error {}
  class PortInUseError extends Error {}
  class LockTimeoutError extends Error {}

  return {
    ConfigManager: {
      findConfigFile: vi.fn(),
      loadConfig: vi.fn(),
      resolveEnvObject: vi.fn(),
      resolveCommandEnv: vi.fn(),
    },
    WorkspaceManager: {
      resolveWorkspaceByName: vi.fn(),
      resolveWorkspaceAuto: vi.fn(),
    },
    LockManager: {
      withLock: vi.fn(),
    },
    ProcessManager: {
      stopProcess: vi.fn(),
      startProcess: vi.fn(),
    },
    StateManager: {
      readState: vi.fn(),
    },
    ConfigNotFoundError,
    WorkspaceResolutionError,
    ProcessStopError,
    ProcessStartError,
    PortInUseError,
    LockTimeoutError,
  };
});

vi.mock('chalk', () => ({
  default: {
    red: (msg: string) => msg,
    yellow: (msg: string) => msg,
    green: (msg: string) => msg,
    gray: (msg: string) => msg,
  },
}));

describe('runRestartCommand', () => {
  const resolvedWorkspace = {
    name: 'ws-one',
    path: '/repo',
    projectConfigPath: '/repo/portmux.config.json',
    workspaceDefinitionName: 'ws-one',
    projectConfig: {
      version: '1.0.0',
      runner: { mode: 'background' as const },
      workspaces: {
        'ws-one': {
          description: '',
          commands: [
            { name: 'api', command: 'npm start', cwd: './api', ports: [3000], env: { FOO: 'BAR' } },
            { name: 'worker', command: 'node worker.js' },
          ],
        },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    vi.mocked(LockManager.withLock).mockImplementation(async (_scope, _key, fn) => {
      await fn();
    });
    vi.mocked(ConfigManager.resolveEnvObject).mockReturnValue({ RESOLVED: 'yes' });
    vi.mocked(ConfigManager.resolveCommandEnv).mockImplementation((cmd: string) => cmd);
    vi.mocked(ProcessManager.stopProcess).mockResolvedValue();
    vi.mocked(ProcessManager.startProcess).mockResolvedValue();
    vi.mocked(StateManager.readState).mockReturnValue({ workspace: 'ws-one', process: 'api', status: 'Running' });
    vi.mocked(WorkspaceManager.resolveWorkspaceByName).mockReturnValue(resolvedWorkspace);
    vi.mocked(WorkspaceManager.resolveWorkspaceAuto).mockReturnValue(resolvedWorkspace);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stops and restarts processes in workspace', async () => {
    vi.mocked(StateManager.readState).mockReturnValue({ workspace: 'ws-one', process: 'api', status: 'Running' });

    await runRestartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('workspace', 'ws-one', expect.any(Function));
    expect(ProcessManager.stopProcess).toHaveBeenCalledWith('ws-one', 'api');
    expect(ProcessManager.stopProcess).toHaveBeenCalledWith('ws-one', 'worker');
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'ws-one',
      'api',
      'npm start',
      expect.objectContaining({
        cwd: './api',
        env: { RESOLVED: 'yes' },
        workspaceKey: '/repo',
        projectRoot: '/repo',
        ports: [3000],
      })
    );
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'ws-one',
      'worker',
      'node worker.js',
      expect.objectContaining({ env: {}, workspaceKey: '/repo', projectRoot: '/repo' })
    );
    expect(console.log).toHaveBeenCalledWith('● プロセス "api" を停止しました');
    expect(console.log).toHaveBeenCalledWith('● プロセス "worker" を停止しました');
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "api" を起動しました');
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "worker" を起動しました');
  });

  it('skips stop when process is not running', async () => {
    vi.mocked(StateManager.readState).mockReturnValueOnce(null).mockReturnValue(null);

    await runRestartCommand('ws-one', 'worker');

    expect(console.log).toHaveBeenCalledWith('● プロセス "worker" は実行中ではありません（停止スキップ）');
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'ws-one',
      'worker',
      'node worker.js',
      expect.objectContaining({ env: {}, workspaceKey: '/repo', projectRoot: '/repo' })
    );
  });

  it('handles ProcessStopError and continues', async () => {
    vi.mocked(StateManager.readState).mockReturnValue({ workspace: 'ws-one', process: 'api', status: 'Running' });
    vi.mocked(ProcessManager.stopProcess).mockRejectedValueOnce(new ProcessStopError('stop fail'));

    await runRestartCommand('ws-one', 'api');

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "api" の停止に失敗しました: stop fail');
    expect(ProcessManager.startProcess).not.toHaveBeenCalled();
  });

  it('reports start failures due to ProcessStartError and PortInUseError', async () => {
    vi.mocked(ProcessManager.startProcess).mockRejectedValueOnce(new ProcessStartError('start fail'));

    await runRestartCommand('ws-one', 'api');

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "api" の起動に失敗しました: start fail');
  });

  it('exits when workspace resolution fails', async () => {
    vi.mocked(WorkspaceManager.resolveWorkspaceByName).mockImplementation(() => {
      throw new ConfigNotFoundError('missing');
    });

    await runRestartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith('エラー: missing');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits on lock timeout', async () => {
    vi.mocked(LockManager.withLock).mockRejectedValueOnce(new LockTimeoutError('timeout'));

    await runRestartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith('エラー: timeout');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
