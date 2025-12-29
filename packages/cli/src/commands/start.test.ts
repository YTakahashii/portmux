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
import { createChalkMock } from '../test-utils/mock-chalk.js';
import { runStartCommand } from './start.js';

vi.mock('../utils/group-instance.js', () => ({
  buildGroupInstanceId: vi.fn(() => 'group-instance-id'),
  buildGroupLabel: vi.fn(() => 'repo-label'),
}));

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
      resolveCommandPorts: vi.fn(),
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

vi.mock('chalk', () => createChalkMock());

describe('runStartCommand', () => {
  const resolvedGroup = {
    name: 'ws-one',
    path: '/repo',
    projectConfigPath: '/repo/portmux.config.json',
    groupDefinitionName: 'ws-one',
    projectConfig: {
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
    vi.mocked(ConfigManager.resolveCommandPorts).mockImplementation((ports) =>
      Array.isArray(ports) ? (ports as number[]) : undefined
    );
    vi.mocked(ProcessManager.startProcess).mockResolvedValue();
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue(resolvedGroup);
    vi.mocked(GroupManager.resolveGroupAuto).mockReturnValue(resolvedGroup);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts all processes in the resolved group', async () => {
    await runStartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('group', 'group-instance-id', expect.any(Function));
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'api',
      'npm start',
      expect.objectContaining({
        cwd: './api',
        env: { RESOLVED: 'yes' },
        groupKey: '/repo',
        projectRoot: '/repo',
        ports: [3000],
        groupLabel: 'repo-label',
        repositoryName: 'ws-one',
        groupDefinitionName: 'ws-one',
        worktreePath: '/repo',
      })
    );
    expect(console.log).toHaveBeenCalledWith('✓ Started process "api" (repo-label (/repo))');
  });

  it('prompts sync when group resolution fails', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockImplementation(() => {
      throw new GroupResolutionError('not found');
    });

    await runStartCommand('default');

    expect(console.error).toHaveBeenCalledWith(
      'Error: not found\nPlease run "portmux sync" in your project directory to register repositories.'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.startProcess).not.toHaveBeenCalled();
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

  it('includes original error message when available', async () => {
    const error = new ProcessStartError('start failed');
    const cause = new Error('permission denied');
    cause.stack = 'permission denied stack';
    (error as { cause?: unknown }).cause = cause;
    vi.mocked(ProcessManager.startProcess).mockRejectedValueOnce(error);

    await runStartCommand('ws-one');

    expect(console.error).toHaveBeenCalledWith(
      'Error: Failed to start process "api": start failed (Original error: permission denied)\nCaused by:\npermission denied stack'
    );
  });

  it('passes worktree override to group resolution and process manager', async () => {
    await runStartCommand('ws-one', undefined, { worktreePath: '/alt', worktreeLabel: 'feature' });

    expect(GroupManager.resolveGroupByName).toHaveBeenCalledWith('ws-one', {
      worktreePath: '/alt',
    });
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'api',
      'npm start',
      expect.objectContaining({
        worktreePath: '/repo',
        branch: 'feature',
      })
    );
  });

  it('passes disableLogs when logging is disabled globally', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue({
      ...resolvedGroup,
      logsDisabled: true,
    });

    await runStartCommand('ws-one');

    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'api',
      'npm start',
      expect.objectContaining({
        disableLogs: true,
      })
    );
  });

  it('exits when config is missing', async () => {
    vi.mocked(GroupManager.resolveGroupAuto).mockImplementation(() => {
      throw new ConfigNotFoundError('missing');
    });

    await runStartCommand();

    expect(console.error).toHaveBeenCalledWith('Error: missing');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('starts every group when startAll is enabled', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue({
      ...resolvedGroup,
      projectConfig: {
        groups: {
          api: {
            description: '',
            commands: [{ name: 'api', command: 'npm start api' }],
          },
          worker: {
            description: '',
            commands: [{ name: 'worker', command: 'npm start worker' }],
          },
        },
      },
      groupDefinitionName: 'api',
    });

    await runStartCommand('ws-one', undefined, { startAll: true });

    expect(ProcessManager.startProcess).toHaveBeenCalledTimes(2);
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'api',
      'npm start api',
      expect.objectContaining({
        repositoryName: 'ws-one',
        groupDefinitionName: 'api',
      })
    );
    expect(ProcessManager.startProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'worker',
      'npm start worker',
      expect.objectContaining({
        repositoryName: 'ws-one',
        groupDefinitionName: 'worker',
      })
    );
  });

  it('errors when process name is combined with startAll', async () => {
    await runStartCommand('ws-one', 'api', { startAll: true });

    expect(console.error).toHaveBeenCalledWith('Error: --all cannot be combined with a process name');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.startProcess).not.toHaveBeenCalled();
  });
});
