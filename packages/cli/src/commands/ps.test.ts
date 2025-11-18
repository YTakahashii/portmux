import { ProcessManager } from '@portmux/core';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { psCommand } from './ps.js';

vi.mock('@portmux/core', () => ({
  ProcessManager: {
    listProcesses: vi.fn(),
  },
}));

vi.mock('chalk', () => ({
  default: {
    yellow: (msg: string) => msg,
    green: (msg: string) => msg,
    red: (msg: string) => msg,
  },
}));

function runPs(): Promise<void> {
  return psCommand.parseAsync(['node', 'ps'], { from: 'user' }).then(() => {});
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

    expect(console.log).toHaveBeenCalledWith('実行中のプロセスがありません');
    expect(console.table).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('prints process table and colored summary for running and error statuses', async () => {
    listProcesses.mockReturnValue([
      {
        groupKey: 'repo1',
        group: 'ws-one',
        process: 'api',
        status: 'Running' as const,
        pid: 123,
      },
      {
        group: 'ws-two',
        process: 'worker',
        status: 'Error' as const,
      },
    ]);

    await runPs();

    expect(console.table).toHaveBeenCalledWith([
      { Repository: 'repo1', Group: 'ws-one', Process: 'api', Status: 'Running', PID: 123 },
      { Repository: '-', Group: 'ws-two', Process: 'worker', Status: 'Error', PID: '-' },
    ]);
    expect(console.log).toHaveBeenCalledWith('  ✓ repo1 (ws-one)/api (PID: 123)');
    expect(console.log).toHaveBeenCalledWith('  ✗ ws-two/worker');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits with error when listing processes throws', async () => {
    listProcesses.mockImplementation(() => {
      throw new Error('boom');
    });

    await runPs();
    expect(console.error).toHaveBeenCalledWith('エラー: boom');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
