import { LockManager, LockTimeoutError, ProcessManager, ProcessStopError, StateManager } from '@portmux/core';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createChalkMock } from '../test-utils/mock-chalk.js';
import { runStopCommand } from './stop.js';

vi.mock('@portmux/core', () => {
  class ProcessStopError extends Error {}
  class LockTimeoutError extends Error {}

  return {
    StateManager: {
      listAllStates: vi.fn(),
    },
    LockManager: {
      withLock: vi.fn(),
    },
    ProcessManager: {
      stopProcess: vi.fn(),
    },
    ProcessStopError,
    LockTimeoutError,
  };
});

vi.mock('chalk', () => createChalkMock());

describe('stopCommand', () => {
  const listAllStates = vi.mocked(StateManager.listAllStates);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(LockManager.withLock).mockImplementation(async (_scope, _key, fn) => {
      await fn();
    });
    vi.mocked(ProcessManager.stopProcess).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prints message when no processes to stop', async () => {
    listAllStates.mockReturnValue([]);

    await runStopCommand();

    expect(console.log).toHaveBeenCalledWith('No processes to stop');
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
  });

  it('errors when multiple groups are running without specifying group', async () => {
    listAllStates.mockReturnValue([
      { group: 'ws1', process: 'api', status: 'Running' as const },
      { group: 'ws2', process: 'worker', status: 'Running' as const },
    ]);

    await runStopCommand();

    expect(console.error).toHaveBeenCalledWith('Error: Multiple groups are running. Please specify a group name.');
    expect(console.error).toHaveBeenCalledWith('Available groups:\n  - ws1 [ws1]\n  - ws2 [ws2]');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
  });

  it('stops all processes in specified group', async () => {
    listAllStates.mockReturnValue([
      { group: 'ws1', process: 'api', status: 'Running' as const },
      { group: 'ws1', process: 'worker', status: 'Running' as const },
      { group: 'ws2', process: 'other', status: 'Running' as const },
    ]);

    await runStopCommand('ws1');

    expect(LockManager.withLock).toHaveBeenCalledWith('group', 'ws1', expect.any(Function));
    expect(ProcessManager.stopProcess).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith('✓ Stopped process "api" (ws1)');
    expect(console.log).toHaveBeenCalledWith('✓ Stopped process "worker" (ws1)');
  });

  it('passes timeout option to stopProcess', async () => {
    listAllStates.mockReturnValue([{ group: 'ws1', process: 'api', status: 'Running' as const }]);

    await runStopCommand('ws1', undefined, { timeout: 500 });

    expect(ProcessManager.stopProcess).toHaveBeenCalledWith('ws1', 'api', 500);
  });

  it('reports when targeted process is not running', async () => {
    listAllStates.mockReturnValue([{ group: 'ws1', process: 'api', status: 'Running' as const }]);

    await runStopCommand('ws1', 'missing');

    expect(console.log).toHaveBeenCalledWith('Process "missing" is not running');
    expect(ProcessManager.stopProcess).not.toHaveBeenCalled();
  });

  it('logs ProcessStopError and continues', async () => {
    listAllStates.mockReturnValue([{ group: 'ws1', process: 'api', status: 'Running' as const }]);
    vi.mocked(ProcessManager.stopProcess).mockRejectedValueOnce(new ProcessStopError('failed'));

    await runStopCommand('ws1');

    expect(console.error).toHaveBeenCalledWith('Error: Failed to stop process "api": failed');
  });

  it('exits on lock timeout', async () => {
    listAllStates.mockReturnValue([{ group: 'ws1', process: 'api', status: 'Running' as const }]);
    vi.mocked(LockManager.withLock).mockRejectedValueOnce(new LockTimeoutError('timeout'));

    await runStopCommand('ws1');

    expect(console.error).toHaveBeenCalledWith('Error: timeout');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
