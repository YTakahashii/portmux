import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  ProcessManager,
  ProcessRestartError,
  WorkspaceManager,
} from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runRestartCommand } from './restart.js';

vi.mock('@portmux/core', () => {
  class ConfigNotFoundError extends Error {}
  class WorkspaceResolutionError extends Error {}
  class ProcessRestartError extends Error {}
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
      restartProcess: vi.fn(),
    },
    ConfigNotFoundError,
    WorkspaceResolutionError,
    ProcessRestartError,
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
    vi.mocked(ProcessManager.restartProcess).mockResolvedValue();
    vi.mocked(WorkspaceManager.resolveWorkspaceByName).mockReturnValue(resolvedWorkspace);
    vi.mocked(WorkspaceManager.resolveWorkspaceAuto).mockReturnValue(resolvedWorkspace);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('再起動処理を各プロセスに委譲する', async () => {
    await runRestartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('workspace', 'ws-one', expect.any(Function));
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
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
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'ws-one',
      'worker',
      'node worker.js',
      expect.objectContaining({ env: {}, workspaceKey: '/repo', projectRoot: '/repo' })
    );
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "api" を再起動しました');
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "worker" を再起動しました');
  });

  it('ProcessRestartError を捕捉してログ出力する', async () => {
    vi.mocked(ProcessManager.restartProcess).mockRejectedValueOnce(new ProcessRestartError('restart fail'));

    await runRestartCommand('ws-one', 'api');

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "api" の再起動に失敗しました: restart fail');
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
