import { GroupManager, StateManager } from '@portmux/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import inquirer from 'inquirer';
import { createChalkMock } from '../test-utils/mock-chalk.js';
import { runStartCommand } from './start.js';
import { runStopCommand } from './stop.js';
import { selectCommand } from './select.js';

vi.mock('@portmux/core', () => ({
  GroupManager: {
    buildSelectableGroups: vi.fn(),
    resolveGroupByName: vi.fn(),
  },
  StateManager: {
    listAllStates: vi.fn(),
  },
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
    Separator: class Separator {
      constructor(public readonly label: string) {
        this.label = label;
      }
    },
  },
}));

vi.mock('./start.js', () => ({
  runStartCommand: vi.fn(),
}));

vi.mock('./stop.js', () => ({
  runStopCommand: vi.fn(),
}));

vi.mock('chalk', () => createChalkMock());

function runSelect(args: string[] = []): Promise<void> {
  return selectCommand.parseAsync(args, { from: 'user' }).then(() => {});
}

describe('selectCommand', () => {
  const buildSelectableGroups = vi.mocked(GroupManager.buildSelectableGroups);
  const resolveGroupByName = vi.mocked(GroupManager.resolveGroupByName);
  const promptMock = vi.mocked(inquirer.prompt);
  const runStartMock = vi.mocked(runStartCommand);
  const runStopMock = vi.mocked(runStopCommand);
  const listAllStates = vi.mocked(StateManager.listAllStates);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    listAllStates.mockReturnValue([]);
    runStopMock.mockResolvedValue();
    resolveGroupByName.mockImplementation((repositoryName: string, options?: { worktreePath?: string }) => ({
      name: repositoryName,
      path: options?.worktreePath ?? `/path/${repositoryName}`,
      projectConfig: {
        groups: {
          default: {
            description: '',
            commands: [],
          },
        },
      },
      projectConfigPath: `${options?.worktreePath ?? `/path/${repositoryName}`}/portmux.config.json`,
      groupDefinitionName: 'default',
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prints message when no selectable group', async () => {
    buildSelectableGroups.mockReturnValue([]);

    await runSelect();

    expect(console.log).toHaveBeenCalledWith('No selectable groups. Please check your global config.');
    expect(runStartMock).not.toHaveBeenCalled();
  });

  it('builds choices and starts selected group', async () => {
    buildSelectableGroups.mockReturnValue([
      {
        projectName: 'proj',
        repositoryName: 'repo1',
        repositoryPath: '/path/repo1',
        worktreePath: '/path/repo1',
        isRunning: true,
        groupDefinitionName: 'default',
        hasConfig: true,
        isPrimary: true,
      },
      {
        projectName: 'proj',
        repositoryName: 'repo2',
        repositoryPath: '/path/repo2',
        worktreePath: '/path/repo2',
        isRunning: false,
        groupDefinitionName: 'default',
        branchLabel: 'feature',
        hasConfig: true,
        isPrimary: false,
      },
    ]);
    promptMock.mockResolvedValue({
      group: {
        repositoryName: 'repo2',
        worktreePath: '/path/repo2',
        branchLabel: 'feature',
      },
    });

    await runSelect();

    expect(promptMock).toHaveBeenCalledWith([
      {
        type: 'list',
        name: 'group',
        message: 'Select a group to start',
        choices: [
          expect.objectContaining({ label: '--- repo1 ---' }),
          {
            name: '[Running] repo1 (/path/repo1)',
            short: 'repo1',
            value: {
              repositoryName: 'repo1',
              worktreePath: '/path/repo1',
              branchLabel: undefined,
              repositoryPath: '/path/repo1',
            },
          },
          expect.objectContaining({ label: '--- repo2 ---' }),
          {
            name: 'repo2:feature (/path/repo2)',
            short: 'repo2:feature',
            value: {
              repositoryName: 'repo2',
              worktreePath: '/path/repo2',
              branchLabel: 'feature',
              repositoryPath: '/path/repo2',
            },
          },
        ],
      },
    ]);
    expect(runStartMock).toHaveBeenCalledWith('repo2', undefined, {
      worktreePath: '/path/repo2',
      worktreeLabel: 'feature',
      groupDefinitionNameOverride: 'default',
    });
    expect(runStopMock).not.toHaveBeenCalled();
  });

  it('passes --all to include all groups', async () => {
    buildSelectableGroups.mockReturnValue([
      {
        projectName: 'proj',
        repositoryName: 'repo',
        repositoryPath: '/path/repo',
        worktreePath: '/path/repo',
        isRunning: false,
        groupDefinitionName: 'default',
        hasConfig: true,
        isPrimary: true,
      },
    ]);
    promptMock.mockResolvedValue({
      group: { repositoryName: 'repo', worktreePath: '/path/repo', repositoryPath: '/path/repo' },
    });

    await runSelect(['--all']);

    expect(buildSelectableGroups).toHaveBeenCalledWith({ includeAll: true });
    expect(runStartMock).toHaveBeenCalledWith('repo', undefined, {
      worktreePath: '/path/repo',
      worktreeLabel: undefined,
      groupDefinitionNameOverride: 'default',
    });
    expect(runStopMock).not.toHaveBeenCalled();
  });

  it('stops running processes in other worktrees before starting selected group', async () => {
    buildSelectableGroups.mockReturnValue([
      {
        projectName: 'proj',
        repositoryName: 'repo1',
        repositoryPath: '/path/repo1',
        worktreePath: '/path/repo1',
        isRunning: false,
        groupDefinitionName: 'default',
        hasConfig: true,
        isPrimary: true,
      },
      {
        projectName: 'proj',
        repositoryName: 'repo1',
        repositoryPath: '/path/repo1',
        worktreePath: '/path/repo1-other',
        isRunning: true,
        groupDefinitionName: 'default',
        branchLabel: 'feature',
        hasConfig: true,
        isPrimary: false,
      },
    ]);
    promptMock.mockResolvedValue({
      group: {
        repositoryName: 'repo1',
        worktreePath: '/path/repo1-other',
        branchLabel: 'feature',
        repositoryPath: '/path/repo1',
      },
    });
    listAllStates.mockReturnValue([
      {
        group: 'repo1::default::aaa',
        repositoryName: 'repo1',
        worktreePath: '/path/repo1',
        status: 'Running',
        process: 'api',
      },
      {
        group: 'repo1::default::bbb',
        repositoryName: 'repo1',
        worktreePath: '/path/repo1-other',
        status: 'Running',
        process: 'api',
      },
    ]);

    await runSelect();

    const stopOrder = runStopMock.mock.invocationCallOrder[0];
    const startOrder = runStartMock.mock.invocationCallOrder[0];

    expect(runStopMock).toHaveBeenCalledWith('repo1::default::aaa');
    expect(runStartMock).toHaveBeenCalledWith('repo1', undefined, {
      worktreePath: '/path/repo1-other',
      worktreeLabel: 'feature',
      groupDefinitionNameOverride: 'default',
    });
    expect(stopOrder).toBeDefined();
    expect(startOrder).toBeDefined();
    expect(stopOrder).toBeLessThan(startOrder!);
  });

  it('restarts all running group definitions from other worktrees', async () => {
    buildSelectableGroups.mockReturnValue([
      {
        projectName: 'proj',
        repositoryName: 'repo1',
        repositoryPath: '/path/repo1',
        worktreePath: '/path/repo1',
        isRunning: false,
        groupDefinitionName: 'default',
        hasConfig: true,
        isPrimary: true,
      },
      {
        projectName: 'proj',
        repositoryName: 'repo1',
        repositoryPath: '/path/repo1',
        worktreePath: '/path/repo1-feature',
        isRunning: true,
        groupDefinitionName: 'default',
        branchLabel: 'feature',
        hasConfig: true,
        isPrimary: false,
      },
    ]);
    resolveGroupByName.mockReturnValue({
      name: 'repo1',
      path: '/path/repo1',
      projectConfig: {
        groups: {
          api: { description: '', commands: [] },
          worker: { description: '', commands: [] },
        },
      },
      projectConfigPath: '/path/repo1/portmux.config.json',
      groupDefinitionName: 'api',
    });
    promptMock.mockResolvedValue({
      group: {
        repositoryName: 'repo1',
        worktreePath: '/path/repo1',
        branchLabel: undefined,
        repositoryPath: '/path/repo1',
      },
    });
    listAllStates.mockReturnValue([
      {
        group: 'repo1::api::aaa',
        repositoryName: 'repo1',
        worktreePath: '/path/repo1-feature',
        status: 'Running',
        process: 'web',
        groupDefinitionName: 'api',
      },
      {
        group: 'repo1::worker::bbb',
        repositoryName: 'repo1',
        worktreePath: '/path/repo1-feature',
        status: 'Running',
        process: 'jobs',
        groupDefinitionName: 'worker',
      },
    ]);

    await runSelect();

    expect(runStopMock).toHaveBeenCalledTimes(2);
    expect(runStopMock).toHaveBeenCalledWith('repo1::api::aaa');
    expect(runStopMock).toHaveBeenCalledWith('repo1::worker::bbb');

    expect(runStartMock).toHaveBeenCalledTimes(2);
    expect(runStartMock).toHaveBeenNthCalledWith(1, 'repo1', undefined, {
      worktreePath: '/path/repo1',
      worktreeLabel: undefined,
      groupDefinitionNameOverride: 'api',
    });
    expect(runStartMock).toHaveBeenNthCalledWith(2, 'repo1', undefined, {
      worktreePath: '/path/repo1',
      worktreeLabel: undefined,
      groupDefinitionNameOverride: 'worker',
    });
  });

  it('exits on error', async () => {
    buildSelectableGroups.mockImplementation(() => {
      throw new Error('boom');
    });

    await runSelect();

    expect(console.error).toHaveBeenCalledWith('Error: boom');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
