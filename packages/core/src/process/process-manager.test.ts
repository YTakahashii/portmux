import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir as systemTmpdir } from 'node:os';
import { ProcessManager, ProcessRestartError, ProcessStartError, ProcessStopError } from './process-manager.js';
import { spawn, type ChildProcess } from 'child_process';
import { kill } from 'process';
import { StateManager, type ProcessState } from '../state/state-manager.js';
import { isPidAlive } from '../state/pid-checker.js';
import { ConfigManager } from '../config/config-manager.js';
import { PortManager } from '../port/port-manager.js';
import { existsSync, openSync, closeSync } from 'fs';

const testHomeDir = mkdtempSync(join(systemTmpdir(), 'portmux-process-home-'));
const testProjectRoot = mkdtempSync(join(systemTmpdir(), 'portmux-process-project-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: (): string => testHomeDir,
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock('process', async () => {
  const actual = await vi.importActual<typeof import('process')>('process');
  return {
    ...actual,
    kill: vi.fn(),
  };
});

vi.mock('../state/state-manager.js', async () => {
  const actual = await vi.importActual<typeof import('../state/state-manager.js')>('../state/state-manager.js');
  return {
    ...actual,
    StateManager: {
      ...actual.StateManager,
      readState: vi.fn(),
      writeState: vi.fn(),
      deleteState: vi.fn(),
      listAllStates: vi.fn(),
      generateLogPath: vi.fn(),
    },
  };
});

vi.mock('../state/pid-checker.js', async () => {
  const actual = await vi.importActual<typeof import('../state/pid-checker.js')>('../state/pid-checker.js');
  return {
    ...actual,
    isPidAlive: vi.fn(),
  };
});

vi.mock('../config/config-manager.js', async () => {
  const actual = await vi.importActual<typeof import('../config/config-manager.js')>('../config/config-manager.js');
  return {
    ...actual,
    ConfigManager: {
      ...actual.ConfigManager,
      findConfigFile: vi.fn(),
    },
  };
});

vi.mock('../port/port-manager.js', async () => {
  const actual = await vi.importActual<typeof import('../port/port-manager.js')>('../port/port-manager.js');
  return {
    ...actual,
    PortManager: {
      ...actual.PortManager,
      reconcileFromState: vi.fn(),
      planReservation: vi.fn(),
      commitReservation: vi.fn(),
      releaseReservation: vi.fn(),
      releaseReservationByProcess: vi.fn(),
    },
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    openSync: vi.fn(),
    closeSync: vi.fn(),
  };
});

describe('ProcessManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(spawn).mockClear();
    vi.mocked(kill).mockClear();
    vi.mocked(StateManager.readState).mockClear();
    vi.mocked(StateManager.writeState).mockClear();
    vi.mocked(StateManager.deleteState).mockClear();
    vi.mocked(StateManager.listAllStates).mockClear();
    vi.mocked(StateManager.generateLogPath).mockClear();
    vi.mocked(isPidAlive).mockClear();
    vi.mocked(ConfigManager.findConfigFile).mockClear();
    vi.mocked(PortManager.reconcileFromState).mockClear();
    vi.mocked(PortManager.planReservation).mockClear();
    vi.mocked(PortManager.commitReservation).mockClear();
    vi.mocked(PortManager.releaseReservation).mockClear();
    vi.mocked(PortManager.releaseReservationByProcess).mockClear();
    vi.mocked(existsSync).mockClear();
    vi.mocked(openSync).mockClear();
    vi.mocked(closeSync).mockClear();
  });

  afterAll(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
    rmSync(testProjectRoot, { recursive: true, force: true });
  });

  describe('startProcess', () => {
    it('starts a process successfully', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(PortManager.reconcileFromState).toHaveBeenCalled();
      expect(StateManager.readState).toHaveBeenCalledWith('group-1', 'api');
      expect(spawn).toHaveBeenCalledWith('npm start', {
        cwd: testProjectRoot,
        env: expect.any(Object),
        detached: true,
        stdio: ['ignore', 1, 1],
        shell: true,
      });
      expect(mockChildProcess.unref).toHaveBeenCalled();
      expect(closeSync).toHaveBeenCalledWith(1);
      expect(StateManager.writeState).toHaveBeenCalledWith(
        'group-1',
        'api',
        expect.objectContaining({
          group: 'group-1',
          groupKey: 'group-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          logPath: join(testHomeDir, 'test.log'),
        })
      );
    });

    it('includes groupKey in the state when provided', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        groupKey: '/repo/path/global',
      });

      expect(StateManager.writeState).toHaveBeenCalledWith(
        'group-1',
        'api',
        expect.objectContaining({
          group: 'group-1',
          groupKey: '/repo/path/global',
          process: 'api',
          status: 'Running',
          pid: 1234,
        })
      );
    });

    it('plans and commits a port reservation', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(PortManager.planReservation).mockResolvedValue({
        reservationToken: 'test-token',
        warnings: [],
      });
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        ports: [3000, 3001],
      });

      expect(PortManager.planReservation).toHaveBeenCalledWith({
        group: 'group-1',
        process: 'api',
        ports: [3000, 3001],
      });
      expect(PortManager.commitReservation).toHaveBeenCalledWith('test-token');
    });

    it('logs port reservation warnings', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(PortManager.planReservation).mockResolvedValue({
        reservationToken: 'test-token',
        warnings: ['Already running'],
      });
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        ports: [3000],
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('Warning: Already running');
      consoleWarnSpy.mockRestore();
    });

    it('throws when a process is already running', async () => {
      const existingState: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(existingState);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).not.toHaveBeenCalled();
    });

    it('clears stale state and starts when the recorded PID is dead', async () => {
      const existingState: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      const mockChildProcess = {
        pid: 5678,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(existingState);
      vi.mocked(isPidAlive).mockImplementation((pid: number) => pid !== 1234);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(StateManager.deleteState).toHaveBeenCalledWith('group-1', 'api');
    });

    it('throws when planning the port reservation fails', async () => {
      const portError = new Error('Port in use');
      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(PortManager.planReservation).mockRejectedValue(portError);

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).not.toHaveBeenCalled();
    });

    it('throws if projectRoot is missing and the config file cannot be found', async () => {
      const configError = new Error('Config file not found');
      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockImplementation(() => {
        throw configError;
      });

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);
    });

    it('throws when log file creation fails', async () => {
      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(PortManager.planReservation).mockResolvedValue({
        reservationToken: 'test-token',
        warnings: [],
      });
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).toHaveBeenCalledWith('test-token');
    });

    it('throws when spawning the process fails', async () => {
      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Command not found');
      });

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
        })
      ).rejects.toThrow(ProcessStartError);

      expect(closeSync).toHaveBeenCalledWith(1);
      expect(PortManager.releaseReservation).not.toHaveBeenCalled();
    });

    it('throws when no PID is available', async () => {
      const mockChildProcess = {
        pid: undefined,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(PortManager.planReservation).mockResolvedValue({
        reservationToken: 'test-token',
        warnings: [],
      });
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).toHaveBeenCalledWith('test-token');
    });

    it('throws when the process exits immediately after start', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(PortManager.planReservation).mockResolvedValue({
        reservationToken: 'test-token',
        warnings: [],
      });
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(false);

      await expect(
        ProcessManager.startProcess('group-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).toHaveBeenCalledWith('test-token');
    });

    it('resolves relative cwd from projectRoot', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        cwd: 'src',
      });

      expect(spawn).toHaveBeenCalledWith(
        'npm start',
        expect.objectContaining({
          cwd: join(testProjectRoot, 'src'),
        })
      );
    });

    it('uses an absolute cwd as-is', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      const absoluteCwd = '/absolute/path';

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        cwd: absoluteCwd,
      });

      expect(spawn).toHaveBeenCalledWith(
        'npm start',
        expect.objectContaining({
          cwd: absoluteCwd,
        })
      );
    });

    it('merges environment variables', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        env: { NODE_ENV: 'test', PORT: '3000' },
      });

      expect(spawn).toHaveBeenCalledWith(
        'npm start',
        expect.objectContaining({
          env: expect.objectContaining({
            NODE_ENV: 'test',
            PORT: '3000',
          }),
        })
      );
    });
  });

  describe('stopProcess', () => {
    it('stops a process successfully', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      vi.mocked(isPidAlive).mockReturnValue(true);
      vi.mocked(kill).mockReturnValue(true);
      // 2回目の isPidAlive 呼び出しで false を返す（停止した）
      vi.mocked(isPidAlive).mockReturnValueOnce(true).mockReturnValueOnce(false);

      await ProcessManager.stopProcess('group-1', 'api');

      expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(StateManager.writeState).toHaveBeenCalledWith(
        'group-1',
        'api',
        expect.objectContaining({
          status: 'Stopped',
          stoppedAt: expect.any(String),
        })
      );
      expect(StateManager.deleteState).toHaveBeenCalledWith('group-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
    });

    it('throws when no state exists', async () => {
      vi.mocked(StateManager.readState).mockReturnValue(null);

      await expect(ProcessManager.stopProcess('group-1', 'api')).rejects.toThrow(ProcessStopError);
    });

    it('deletes the state if it is already stopped', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Stopped',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);

      await ProcessManager.stopProcess('group-1', 'api');

      expect(StateManager.deleteState).toHaveBeenCalledWith('group-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
      expect(kill).not.toHaveBeenCalled();
    });

    it('deletes the state when no PID is recorded', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);

      await ProcessManager.stopProcess('group-1', 'api');

      expect(StateManager.deleteState).toHaveBeenCalledWith('group-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
      expect(kill).not.toHaveBeenCalled();
    });

    it('updates the state and exits when the process is already dead', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      vi.mocked(isPidAlive).mockReturnValue(false);

      await ProcessManager.stopProcess('group-1', 'api');

      expect(StateManager.writeState).toHaveBeenCalledWith(
        'group-1',
        'api',
        expect.objectContaining({
          status: 'Stopped',
          stoppedAt: expect.any(String),
        })
      );
      expect(StateManager.deleteState).toHaveBeenCalledWith('group-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
      expect(kill).not.toHaveBeenCalled();
    });

    it('throws when sending SIGTERM fails', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      vi.mocked(isPidAlive).mockReturnValue(true);
      vi.mocked(kill).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(ProcessManager.stopProcess('group-1', 'api')).rejects.toThrow(ProcessStopError);
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
    });

    it('sends SIGKILL when the stop times out', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      // 最初の呼び出しで true、その後も true を返し続ける（停止しない）
      vi.mocked(isPidAlive).mockImplementation(() => {
        return true;
      });
      vi.mocked(kill).mockReturnValue(true);

      // タイムアウトを短く設定
      await expect(ProcessManager.stopProcess('group-1', 'api', 100)).rejects.toThrow(ProcessStopError);

      expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
      // SIGKILL も呼ばれるはず（タイムアウト後）
      expect(kill).toHaveBeenCalledWith(1234, 'SIGKILL');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
    });

    it('throws when the process remains alive even after SIGKILL', async () => {
      const state: ProcessState = {
        group: 'group-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      vi.mocked(isPidAlive).mockReturnValue(true); // 常に生存している
      vi.mocked(kill).mockReturnValue(true);

      await expect(ProcessManager.stopProcess('group-1', 'api', 100)).rejects.toThrow(ProcessStopError);
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalledWith('group-1', 'api');
    });
  });

  describe('listProcesses', () => {
    it('lists the state of every process', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          groupKey: '/repo/path/one',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
          logPath: '/path/to/log1.log',
        },
        {
          group: 'group-2',
          groupKey: '/repo/path/two',
          process: 'worker',
          status: 'Running',
          pid: 5678,
          startedAt: '2024-01-01T01:00:00.000Z',
          logPath: '/path/to/log2.log',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);
      vi.mocked(isPidAlive).mockReturnValue(true);

      const processes = ProcessManager.listProcesses();

      expect(processes).toHaveLength(2);
      expect(processes[0]).toEqual({
        group: 'group-1',
        groupKey: '/repo/path/one',
        process: 'api',
        status: 'Running',
        pid: 1234,
        logPath: '/path/to/log1.log',
      });
      expect(processes[1]).toEqual({
        group: 'group-2',
        groupKey: '/repo/path/two',
        process: 'worker',
        status: 'Running',
        pid: 5678,
        logPath: '/path/to/log2.log',
      });
    });

    it('updates the state for dead processes', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          group: 'group-2',
          process: 'worker',
          status: 'Running',
          pid: 5678,
          startedAt: '2024-01-01T01:00:00.000Z',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);
      vi.mocked(isPidAlive).mockImplementation((pid: number) => pid === 1234);

      const processes = ProcessManager.listProcesses();

      expect(processes).toHaveLength(2);
      expect(processes[0]?.status).toBe('Running');
      expect(processes[1]?.status).toBe('Stopped');
      expect(StateManager.writeState).toHaveBeenCalledWith(
        'group-2',
        'worker',
        expect.objectContaining({
          status: 'Stopped',
          stoppedAt: expect.any(String),
        })
      );
      expect(StateManager.deleteState).toHaveBeenCalledWith('group-2', 'worker');
    });

    it('returns processes without a PID as-is', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Stopped',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const processes = ProcessManager.listProcesses();

      expect(processes).toHaveLength(1);
      expect(processes[0]?.status).toBe('Stopped');
      expect(isPidAlive).not.toHaveBeenCalled();
    });

    it('returns Running states without a PID as-is', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Running',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const processes = ProcessManager.listProcesses();

      expect(processes).toHaveLength(1);
      expect(processes[0]?.status).toBe('Running');
      expect(isPidAlive).not.toHaveBeenCalled();
    });
  });

  describe('restartProcess', () => {
    it('stops before starting when state exists', async () => {
      vi.mocked(StateManager.readState).mockReturnValue({
        group: 'group-1',
        process: 'api',
        status: 'Running',
      });
      const stopSpy = vi.spyOn(ProcessManager, 'stopProcess').mockResolvedValue();
      const startSpy = vi.spyOn(ProcessManager, 'startProcess').mockResolvedValue();

      await ProcessManager.restartProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(stopSpy).toHaveBeenCalledWith('group-1', 'api');
      expect(startSpy).toHaveBeenCalledWith(
        'group-1',
        'api',
        'npm start',
        expect.objectContaining({ projectRoot: testProjectRoot })
      );
    });

    it('starts without stopping when no state exists', async () => {
      vi.mocked(StateManager.readState).mockReturnValue(null);
      const stopSpy = vi.spyOn(ProcessManager, 'stopProcess').mockResolvedValue();
      const startSpy = vi.spyOn(ProcessManager, 'startProcess').mockResolvedValue();

      await ProcessManager.restartProcess('group-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(stopSpy).not.toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledWith(
        'group-1',
        'api',
        'npm start',
        expect.objectContaining({ projectRoot: testProjectRoot })
      );
    });

    it('throws ProcessRestartError when stop fails', async () => {
      vi.mocked(StateManager.readState).mockReturnValue({
        group: 'group-1',
        process: 'api',
        status: 'Running',
      });
      vi.spyOn(ProcessManager, 'stopProcess').mockRejectedValue(new ProcessStopError('failed to stop'));
      vi.spyOn(ProcessManager, 'startProcess').mockResolvedValue();

      await expect(
        ProcessManager.restartProcess('group-1', 'api', 'npm start', { projectRoot: testProjectRoot })
      ).rejects.toBeInstanceOf(ProcessRestartError);
      expect(StateManager.writeState).not.toHaveBeenCalled();
    });

    it('writes an Error state and throws ProcessRestartError when start fails', async () => {
      vi.mocked(StateManager.readState).mockReturnValue({
        group: 'group-1',
        process: 'api',
        status: 'Running',
        logPath: '/tmp/log.log',
        ports: [3000],
      });
      vi.spyOn(ProcessManager, 'stopProcess').mockResolvedValue();
      vi.spyOn(ProcessManager, 'startProcess').mockRejectedValue(new ProcessStartError('failed to start'));

      await expect(
        ProcessManager.restartProcess('group-1', 'api', 'npm start', { projectRoot: testProjectRoot })
      ).rejects.toBeInstanceOf(ProcessRestartError);
      expect(StateManager.writeState).toHaveBeenCalledWith(
        'group-1',
        'api',
        expect.objectContaining({
          status: 'Error',
          error: 'failed to start',
          logPath: '/tmp/log.log',
          ports: [3000],
        })
      );
    });
  });
});
