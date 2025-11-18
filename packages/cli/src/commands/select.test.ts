import { WorkspaceManager } from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import inquirer from 'inquirer';
import { runStartCommand } from './start.js';
import { selectCommand } from './select.js';

vi.mock('@portmux/core', () => ({
  WorkspaceManager: {
    buildSelectableWorkspaces: vi.fn(),
  },
  parseGitWorktreeList: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
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

vi.mock('chalk', () => ({
  default: {
    yellow: (msg: string) => msg,
    red: (msg: string) => msg,
  },
}));

function runSelect(args: string[] = []): Promise<void> {
  return selectCommand.parseAsync(['node', 'select', ...args], { from: 'user' }).then(() => {});
}

describe('selectCommand', () => {
  const buildSelectableWorkspaces = vi.mocked(WorkspaceManager.buildSelectableWorkspaces);
  const promptMock = vi.mocked(inquirer.prompt);
  const runStartMock = vi.mocked(runStartCommand);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prints message when no selectable workspace', async () => {
    buildSelectableWorkspaces.mockReturnValue([]);

    await runSelect();

    expect(console.log).toHaveBeenCalledWith(
      '選択可能なワークスペースがありません。グローバル設定を確認してください。'
    );
    expect(runStartMock).not.toHaveBeenCalled();
  });

  it('builds choices and starts selected workspace', async () => {
    buildSelectableWorkspaces.mockReturnValue([
      {
        projectName: 'proj',
        repositoryName: 'repo1',
        path: '/path/repo1',
        isRunning: true,
        workspaceDefinitionName: 'default',
      },
      {
        projectName: 'proj',
        repositoryName: 'repo2',
        path: '/path/repo2',
        isRunning: false,
        workspaceDefinitionName: 'default',
      },
    ]);
    promptMock.mockResolvedValue({ workspace: 'repo2' });

    await runSelect();

    expect(promptMock).toHaveBeenCalledWith([
      {
        type: 'list',
        name: 'workspace',
        message: '起動するワークスペースを選択してください',
        choices: [
          expect.objectContaining({ label: '--- proj ---' }),
          { name: '[Running] repo1 (/path/repo1)', value: 'repo1', short: 'repo1' },
          { name: 'repo2 (/path/repo2)', value: 'repo2', short: 'repo2' },
        ],
      },
    ]);
    expect(runStartMock).toHaveBeenCalledWith('repo2');
  });

  it('passes --all to include all workspaces', async () => {
    buildSelectableWorkspaces.mockReturnValue([
      {
        projectName: 'proj',
        repositoryName: 'repo',
        path: '/path/repo',
        isRunning: false,
        workspaceDefinitionName: 'default',
      },
    ]);
    promptMock.mockResolvedValue({ workspace: 'repo' });

    await runSelect(['--all']);

    expect(buildSelectableWorkspaces).toHaveBeenCalledWith([], { includeAll: true });
    expect(runStartMock).toHaveBeenCalledWith('repo');
  });

  it('exits on error', async () => {
    buildSelectableWorkspaces.mockImplementation(() => {
      throw new Error('boom');
    });

    await runSelect();

    expect(console.error).toHaveBeenCalledWith('エラー: boom');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
