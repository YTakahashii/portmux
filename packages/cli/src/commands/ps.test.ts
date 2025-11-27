import { ProcessManager } from '@portmux/core';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import { join } from 'path';
import { createChalkMock } from '../test-utils/mock-chalk.js';
import { psCommand } from './ps.js';

vi.mock('@portmux/core', () => ({
  ProcessManager: {
    listProcesses: vi.fn(),
  },
}));

vi.mock('chalk', () => createChalkMock());

function runPs(): Promise<void> {
  return psCommand.parseAsync([], { from: 'user' }).then(() => {});
}

describe('psCommand', () => {
  const listProcesses = vi.mocked(ProcessManager.listProcesses);

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('prints message when no processes are running', async () => {
    listProcesses.mockReturnValue([]);

    await runPs();

    expect(console.log).toHaveBeenCalledWith('No running processes');
    expect(console.table).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('prints process table and colored summary for running and error statuses', async () => {
    listProcesses.mockReturnValue([
      {
        groupKey: '/repo/main',
        group: 'instance-one',
        groupLabel: 'repo-one:main',
        repositoryName: 'repo-one',
        groupDefinitionName: 'ws-one',
        process: 'api',
        status: 'Running' as const,
        pid: 123,
        worktreePath: '/repo/main',
      },
      {
        group: 'instance-two',
        process: 'worker',
        status: 'Error' as const,
      },
    ]);

    await runPs();

    expect(console.table).toHaveBeenCalledWith([
      { Repository: 'repo-one:main', Group: 'ws-one', Process: 'api', Status: 'Running', PID: 123 },
      { Repository: 'instance-two', Group: 'instance-two', Process: 'worker', Status: 'Error', PID: '-' },
    ]);
    expect(console.log).toHaveBeenCalledWith('  ✓ repo-one:main (/repo/main)/api (PID: 123)');
    expect(console.log).toHaveBeenCalledWith('  ✗ instance-two/worker');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits with error when listing processes throws', async () => {
    listProcesses.mockImplementation(() => {
      throw new Error('boom');
    });

    await runPs();
    expect(console.error).toHaveBeenCalledWith('Error: boom');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('shortens home directory paths in repository labels', async () => {
    const home = os.homedir();
    const worktreePath = join(home, 'repos', 'one');
    const displayPath = `~${worktreePath.slice(home.length)}`;
    listProcesses.mockReturnValue([
      {
        group: 'instance-one',
        groupLabel: 'repo-one:main',
        repositoryName: 'repo-one',
        process: 'api',
        status: 'Running' as const,
        pid: 123,
        worktreePath,
      },
    ]);

    await runPs();

    expect(console.table).toHaveBeenCalledWith([
      {
        Repository: 'repo-one:main',
        Group: 'repo-one:main',
        Process: 'api',
        Status: 'Running',
        PID: 123,
      },
    ]);
    expect(console.log).toHaveBeenCalledWith(`  ✓ repo-one:main (${displayPath})/api (PID: 123)`);
  });
});
