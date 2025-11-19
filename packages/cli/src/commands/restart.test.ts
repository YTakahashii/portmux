import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  ProcessManager,
  ProcessRestartError,
  GroupManager,
} from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runRestartCommand } from './restart.js';

vi.mock('@portmux/core', () => {
  class ConfigNotFoundError extends Error {}
  class GroupResolutionError extends Error {}
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
    GroupManager: {
      resolveGroupByName: vi.fn(),
      resolveGroupAuto: vi.fn(),
    },
    LockManager: {
      withLock: vi.fn(),
    },
    ProcessManager: {
      restartProcess: vi.fn(),
    },
    ConfigNotFoundError,
    GroupResolutionError,
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
  const resolvedGroup = {
    name: 'ws-one',
    path: '/repo',
    projectConfigPath: '/repo/portmux.config.json',
    groupDefinitionName: 'ws-one',
    projectConfig: {
      groups: {
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
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue(resolvedGroup);
    vi.mocked(GroupManager.resolveGroupAuto).mockReturnValue(resolvedGroup);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates restart logic to each process', async () => {
    await runRestartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('group', 'ws-one', expect.any(Function));
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'ws-one',
      'api',
      'npm start',
      expect.objectContaining({
        cwd: './api',
        env: { RESOLVED: 'yes' },
        groupKey: '/repo',
        projectRoot: '/repo',
        ports: [3000],
      })
    );
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'ws-one',
      'worker',
      'node worker.js',
      expect.objectContaining({ env: {}, groupKey: '/repo', projectRoot: '/repo' })
    );
    expect(console.log).toHaveBeenCalledWith('✓ Restarted process "api"');
    expect(console.log).toHaveBeenCalledWith('✓ Restarted process "worker"');
  });

  it('logs ProcessRestartError failures', async () => {
    vi.mocked(ProcessManager.restartProcess).mockRejectedValueOnce(new ProcessRestartError('restart fail'));

    await runRestartCommand('ws-one', 'api');

    expect(console.error).toHaveBeenCalledWith('Error: Failed to restart process "api": restart fail');
  });

  it('exits when group resolution fails', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockImplementation(() => {
      throw new ConfigNotFoundError('missing');
    });

    await runRestartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith('Error: missing');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits on lock timeout', async () => {
    vi.mocked(LockManager.withLock).mockRejectedValueOnce(new LockTimeoutError('timeout'));

    await runRestartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith('Error: timeout');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
