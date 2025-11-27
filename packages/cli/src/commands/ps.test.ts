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

interface TableRow {
  Repository: string;
  Group: string;
  Process: string;
  Status: string;
  PID: string | number;
}

function buildExpectedTable(rows: TableRow[]): string[] {
  const headers = ['Repository', 'Group', 'Process', 'Status', 'PID'] as const;
  const columnWidths = headers.map((header) =>
    Math.max(header.length, ...rows.map((row) => String(row[header]).length))
  );
  const formatRow = (values: string[]): string =>
    `│ ${values.map((value, index) => value.padEnd(columnWidths[index] ?? 0)).join(' │ ')} │`;
  const border = (left: string, join: string, right: string): string =>
    `${left}${columnWidths.map((w) => '─'.repeat(w + 2)).join(join)}${right}`;

  return [
    border('┌', '┬', '┐'),
    formatRow(headers.map((header) => header)),
    border('├', '┼', '┤'),
    ...rows.map((row) => formatRow(headers.map((header) => String(row[header])))),
    border('└', '┴', '┘'),
  ];
}

describe('psCommand', () => {
  const listProcesses = vi.mocked(ProcessManager.listProcesses);

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
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

    const calls = vi.mocked(console.log).mock.calls.map(([msg]) => String(msg));
    expect(calls).toEqual([
      ...buildExpectedTable([
        { Repository: 'repo-one:main', Group: 'ws-one', Process: 'api', Status: 'Running', PID: 123 },
        { Repository: 'instance-two', Group: 'instance-two', Process: 'worker', Status: 'Error', PID: '-' },
      ]),
      '  ✓ repo-one:main (/repo/main)/api (PID: 123)',
      '  ✗ instance-two/worker',
    ]);
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

    const calls = vi.mocked(console.log).mock.calls.map(([msg]) => String(msg));
    expect(calls).toEqual([
      ...buildExpectedTable([
        { Repository: 'repo-one:main', Group: 'repo-one:main', Process: 'api', Status: 'Running', PID: 123 },
      ]),
      `  ✓ repo-one:main (${displayPath})/api (PID: 123)`,
    ]);
  });
});
