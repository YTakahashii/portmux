import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  ProcessManager,
  ProcessRestartError,
  GroupManager,
  StateManager,
} from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createChalkMock } from '../test-utils/mock-chalk.js';
import { runRestartCommand } from './restart.js';

vi.mock('../utils/group-instance.js', () => ({
  buildGroupInstanceId: vi.fn(() => 'group-instance-id'),
  buildGroupLabel: vi.fn(() => 'repo-label'),
}));

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
      restartProcess: vi.fn(),
    },
    StateManager: {
      listAllStates: vi.fn(),
    },
    ConfigNotFoundError,
    GroupResolutionError,
    ProcessRestartError,
    PortInUseError,
    LockTimeoutError,
  };
});

vi.mock('chalk', () => createChalkMock());

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
    vi.mocked(ConfigManager.resolveCommandPorts).mockImplementation((ports) =>
      Array.isArray(ports) ? (ports as number[]) : undefined
    );
    vi.mocked(ProcessManager.restartProcess).mockResolvedValue();
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue(resolvedGroup);
    vi.mocked(GroupManager.resolveGroupAuto).mockReturnValue(resolvedGroup);
    vi.mocked(StateManager.listAllStates).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates restart logic to each process', async () => {
    await runRestartCommand('ws-one');

    expect(LockManager.withLock).toHaveBeenCalledWith('group', 'group-instance-id', expect.any(Function));
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
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
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'worker',
      'node worker.js',
      expect.objectContaining({
        env: {},
        groupKey: '/repo',
        projectRoot: '/repo',
        groupLabel: 'repo-label',
        repositoryName: 'ws-one',
        groupDefinitionName: 'ws-one',
        worktreePath: '/repo',
      })
    );
    expect(console.log).toHaveBeenCalledWith('✓ Restarted process "api"');
    expect(console.log).toHaveBeenCalledWith('✓ Restarted process "worker"');
  });

  it('passes disableLogs when logging is disabled globally', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue({
      ...resolvedGroup,
      logsDisabled: true,
    });

    await runRestartCommand('ws-one', 'api');

    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'api',
      'npm start',
      expect.objectContaining({
        disableLogs: true,
      })
    );
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

  it('restarts all running processes when --all is provided', async () => {
    vi.mocked(GroupManager.resolveGroupByName).mockReturnValue({
      ...resolvedGroup,
      projectConfig: {
        groups: {
          api: {
            description: '',
            commands: [
              { name: 'api', command: 'npm run api' },
              { name: 'worker', command: 'npm run worker' },
            ],
          },
          jobs: {
            description: '',
            commands: [{ name: 'jobs', command: 'npm run jobs' }],
          },
        },
      },
      groupDefinitionName: 'api',
    });
    vi.mocked(StateManager.listAllStates).mockReturnValue([
      {
        group: 'ws-one::api::a',
        repositoryName: 'ws-one',
        worktreePath: '/repo',
        status: 'Running',
        process: 'api',
        groupDefinitionName: 'api',
      },
      {
        group: 'ws-one::jobs::b',
        repositoryName: 'ws-one',
        worktreePath: '/repo',
        status: 'Running',
        process: 'jobs',
        groupDefinitionName: 'jobs',
      },
      {
        group: 'other::api::c',
        repositoryName: 'other',
        worktreePath: '/repo',
        status: 'Running',
        process: 'api',
        groupDefinitionName: 'api',
      },
      {
        group: 'ws-one::api::d',
        repositoryName: 'ws-one',
        worktreePath: '/other-worktree',
        status: 'Running',
        process: 'worker',
        groupDefinitionName: 'api',
      },
    ]);

    await runRestartCommand('ws-one', undefined, { restartAll: true });

    expect(ProcessManager.restartProcess).toHaveBeenCalledTimes(2);
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'api',
      'npm run api',
      expect.objectContaining({
        repositoryName: 'ws-one',
        groupDefinitionName: 'api',
        worktreePath: '/repo',
      })
    );
    expect(ProcessManager.restartProcess).toHaveBeenCalledWith(
      'group-instance-id',
      'jobs',
      'npm run jobs',
      expect.objectContaining({
        repositoryName: 'ws-one',
        groupDefinitionName: 'jobs',
        worktreePath: '/repo',
      })
    );
  });

  it('logs when no processes are running with --all', async () => {
    await runRestartCommand('ws-one', undefined, { restartAll: true });

    expect(console.log).toHaveBeenCalledWith('No running processes to restart.');
    expect(ProcessManager.restartProcess).not.toHaveBeenCalled();
  });

  it('errors when process name is combined with --all', async () => {
    await runRestartCommand('ws-one', 'api', { restartAll: true });

    expect(console.error).toHaveBeenCalledWith('Error: --all cannot be combined with a process name');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.restartProcess).not.toHaveBeenCalled();
  });
});
