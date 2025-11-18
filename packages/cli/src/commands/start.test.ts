import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  ProcessManager,
  ProcessStartError,
  WorkspaceManager,
  WorkspaceResolutionError,
} from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runStartCommand } from './start.js';

vi.mock('@portmux/core', () => {
  class ConfigNotFoundError extends Error {}
  class WorkspaceResolutionError extends Error {}
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
      startProcess: vi.fn(),
    },
    ConfigNotFoundError,
    WorkspaceResolutionError,
    ProcessStartError,
    PortInUseError,
    LockTimeoutError,
  };
});

vi.mock('chalk', () => ({
  default: {
    green: (msg: string) => msg,
    red: (msg: string) => msg,
  },
}));

describe('runStartCommand', () => {
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
          commands: [{ name: 'api', command: 'npm start', cwd: './api', ports: [3000], env: { FOO: 'BAR' } }],
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
    vi.mocked(ConfigManager.resolveCommandEnv).mockImplementation((command: string) => command);
    vi.mocked(ProcessManager.startProcess).mockResolvedValue();
    vi.mocked(WorkspaceManager.resolveWorkspaceByName).mockReturnValue(resolvedWorkspace);
    vi.mocked(WorkspaceManager.resolveWorkspaceAuto).mockReturnValue(resolvedWorkspace);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts all processes in the resolved workspace', async () => {
    await runStartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('workspace', 'ws-one', expect.any(Function));
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
    expect(console.log).toHaveBeenCalledWith('✓ プロセス "api" を起動しました');
  });

  it('falls back to config file when workspace resolution fails', async () => {
    vi.mocked(WorkspaceManager.resolveWorkspaceByName).mockImplementation(() => {
      throw new WorkspaceResolutionError('not found');
    });
    vi.mocked(ConfigManager.findConfigFile).mockReturnValue('/workspace/portmux.config.json');
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({
      version: '1.0.0',
      workspaces: {
        default: {
          description: '',
          commands: [{ name: 'worker', command: 'node worker.js' }],
        },
      },
    });

    await runStartCommand('default');

    expect(ConfigManager.findConfigFile).toHaveBeenCalled();
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'default',
      'worker',
      'node worker.js',
      expect.objectContaining({
        workspaceKey: '/workspace',
        projectRoot: '/workspace',
      })
    );
  });

  it('logs error when requested process is not found', async () => {
    await runStartCommand('ws-one', 'missing');

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "missing" が見つかりません');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.startProcess).not.toHaveBeenCalled();
  });

  it('reports start failures with ProcessStartError and PortInUseError', async () => {
    vi.mocked(ProcessManager.startProcess).mockRejectedValueOnce(new ProcessStartError('start failed'));

    await runStartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith('エラー: プロセス "api" の起動に失敗しました: start failed');
  });

  it('exits when config is missing', async () => {
    vi.mocked(WorkspaceManager.resolveWorkspaceAuto).mockImplementation(() => {
      throw new ConfigNotFoundError('missing');
    });

    await runStartCommand();

    expect(console.error).toHaveBeenCalledWith('エラー: missing');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
