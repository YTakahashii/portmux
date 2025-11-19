import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  ProcessManager,
  ProcessStartError,
  GroupManager,
  GroupResolutionError,
} from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runStartCommand } from './start.js';

vi.mock('@portmux/core', () => {
  class ConfigNotFoundError extends Error {}
  class GroupResolutionError extends Error {}
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
    GroupManager: {
      resolveGroupByName: vi.fn(),
      resolveGroupAuto: vi.fn(),
    },
    LockManager: {
      withLock: vi.fn(),
    },
    ProcessManager: {
      startProcess: vi.fn(),
    },
    ConfigNotFoundError,
    GroupResolutionError,
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
  const resolvedGroup = {
    name: 'ws-one',
    path: '/repo',
    projectConfigPath: '/repo/portmux.config.json',
    groupDefinitionName: 'ws-one',
    projectConfig: {
      version: '1.0.0',
      groups: {
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
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue(resolvedGroup);
    vi.mocked(GroupManager.resolveGroupAuto).mockReturnValue(resolvedGroup);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts all processes in the resolved group', async () => {
    await runStartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('group', 'ws-one', expect.any(Function));
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
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
    expect(console.log).toHaveBeenCalledWith('✓ Started process "api"');
  });

  it('falls back to config file when group resolution fails', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockImplementation(() => {
      throw new GroupResolutionError('not found');
    });
    vi.mocked(ConfigManager.findConfigFile).mockReturnValue('/group/portmux.config.json');
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({
      version: '1.0.0',
      groups: {
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
        groupKey: '/group',
        projectRoot: '/group',
      })
    );
  });

  it('logs error when requested process is not found', async () => {
    await runStartCommand('ws-one', 'missing');

    expect(console.error).toHaveBeenCalledWith('Error: Process "missing" not found');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.startProcess).not.toHaveBeenCalled();
  });

  it('reports start failures with ProcessStartError and PortInUseError', async () => {
    vi.mocked(ProcessManager.startProcess).mockRejectedValueOnce(new ProcessStartError('start failed'));

    await runStartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith('Error: Failed to start process "api": start failed');
  });

  it('exits when config is missing', async () => {
    vi.mocked(GroupManager.resolveGroupAuto).mockImplementation(() => {
      throw new ConfigNotFoundError('missing');
    });

    await runStartCommand();

    expect(console.error).toHaveBeenCalledWith('Error: missing');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
