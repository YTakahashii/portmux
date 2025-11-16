import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir as systemTmpdir } from 'node:os';
import { ProcessManager, ProcessStartError, ProcessStopError } from './process-manager.js';
import { spawn, type ChildProcess } from 'child_process';
import { kill } from 'process';
import { StateManager, type ProcessState } from '../state/state-manager.js';
import { isPidAlive } from '../state/pid-checker.js';
import { ConfigManager } from '../config/config-manager.js';
import { PortManager } from '../port/port-manager.js';
import { existsSync, statSync, renameSync, unlinkSync, openSync, closeSync } from 'fs';

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
    statSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
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
    vi.mocked(statSync).mockClear();
    vi.mocked(renameSync).mockClear();
    vi.mocked(unlinkSync).mockClear();
    vi.mocked(openSync).mockClear();
    vi.mocked(closeSync).mockClear();
  });

  afterAll(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
    rmSync(testProjectRoot, { recursive: true, force: true });
  });

  describe('startProcess', () => {
    it('プロセスを正常に起動できる', async () => {
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(PortManager.reconcileFromState).toHaveBeenCalled();
      expect(StateManager.readState).toHaveBeenCalledWith('workspace-1', 'api');
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
        'workspace-1',
        'api',
        expect.objectContaining({
          workspace: 'workspace-1',
          workspaceKey: 'workspace-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          logPath: join(testHomeDir, 'test.log'),
        })
      );
    });

    it('workspaceKey が指定されている場合は状態に含める', async () => {
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        workspaceKey: 'global-workspace',
      });

      expect(StateManager.writeState).toHaveBeenCalledWith(
        'workspace-1',
        'api',
        expect.objectContaining({
          workspace: 'workspace-1',
          workspaceKey: 'global-workspace',
          process: 'api',
          status: 'Running',
          pid: 1234,
        })
      );
    });

    it('ポート予約を計画して確定する', async () => {
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        ports: [3000, 3001],
      });

      expect(PortManager.planReservation).toHaveBeenCalledWith({
        workspace: 'workspace-1',
        process: 'api',
        ports: [3000, 3001],
      });
      expect(PortManager.commitReservation).toHaveBeenCalledWith('test-token');
    });

    it('ポート予約の警告を表示する', async () => {
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
        warnings: ['警告: 既に起動しています'],
      });
      vi.mocked(StateManager.generateLogPath).mockReturnValue(join(testHomeDir, 'test.log'));
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
        ports: [3000],
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('警告: 警告: 既に起動しています');
      consoleWarnSpy.mockRestore();
    });

    it('既に起動しているプロセスがある場合はエラーを投げる', async () => {
      const existingState: ProcessState = {
        workspace: 'workspace-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(existingState);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await expect(
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).not.toHaveBeenCalled();
    });

    it('PID が死んでいる既存プロセスがある場合は状態をクリアして起動する', async () => {
      const existingState: ProcessState = {
        workspace: 'workspace-1',
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-1', 'api');
    });

    it('ポート予約に失敗した場合はエラーを投げる', async () => {
      const portError = new Error('Port in use');
      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(PortManager.planReservation).mockRejectedValue(portError);

      await expect(
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).not.toHaveBeenCalled();
    });

    it('projectRoot が指定されていない場合、設定ファイルが見つからないとエラーを投げる', async () => {
      const configError = new Error('Config file not found');
      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockImplementation(() => {
        throw configError;
      });

      await expect(
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);
    });

    it('ログファイルの作成に失敗した場合はエラーを投げる', async () => {
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
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).toHaveBeenCalledWith('test-token');
    });

    it('プロセス起動に失敗した場合はエラーを投げる', async () => {
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
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
        })
      ).rejects.toThrow(ProcessStartError);

      expect(closeSync).toHaveBeenCalledWith(1);
      expect(PortManager.releaseReservation).not.toHaveBeenCalled();
    });

    it('PID が取得できない場合はエラーを投げる', async () => {
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
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).toHaveBeenCalledWith('test-token');
    });

    it('プロセスが起動直後に終了した場合はエラーを投げる', async () => {
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
        ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
          projectRoot: testProjectRoot,
          ports: [3000],
        })
      ).rejects.toThrow(ProcessStartError);

      expect(PortManager.releaseReservation).toHaveBeenCalledWith('test-token');
    });

    it('ログローテーションを実行する', async () => {
      const mockChildProcess = {
        pid: 1234,
        unref: vi.fn(),
      } as unknown as ChildProcess;

      const logPath = join(testHomeDir, 'test.log');
      const mockStats = {
        size: 11 * 1024 * 1024, // 11MB (MAX_SIZE を超える)
      };

      vi.mocked(PortManager.reconcileFromState).mockReturnValue(undefined);
      vi.mocked(StateManager.readState).mockReturnValue(null);
      vi.mocked(ConfigManager.findConfigFile).mockReturnValue(join(testProjectRoot, 'portmux.config.json'));
      vi.mocked(StateManager.generateLogPath).mockReturnValue(logPath);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue(mockStats as ReturnType<typeof statSync>);
      vi.mocked(openSync).mockReturnValue(1);
      vi.mocked(spawn).mockReturnValue(mockChildProcess);
      vi.mocked(isPidAlive).mockReturnValue(true);

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
        projectRoot: testProjectRoot,
      });

      expect(renameSync).toHaveBeenCalled();
    });

    it('cwd が相対パスの場合は projectRoot 基準で解決する', async () => {
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
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

    it('cwd が絶対パスの場合はそのまま使用する', async () => {
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
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

    it('環境変数をマージする', async () => {
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

      await ProcessManager.startProcess('workspace-1', 'api', 'npm start', {
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
    it('プロセスを正常に停止できる', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
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

      await ProcessManager.stopProcess('workspace-1', 'api');

      expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(StateManager.writeState).toHaveBeenCalledWith(
        'workspace-1',
        'api',
        expect.objectContaining({
          status: 'Stopped',
          stoppedAt: expect.any(String),
        })
      );
      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalled();
    });

    it('状態が見つからない場合はエラーを投げる', async () => {
      vi.mocked(StateManager.readState).mockReturnValue(null);

      await expect(ProcessManager.stopProcess('workspace-1', 'api')).rejects.toThrow(ProcessStopError);
    });

    it('既に停止している場合は状態を削除する', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
        process: 'api',
        status: 'Stopped',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);

      await ProcessManager.stopProcess('workspace-1', 'api');

      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    });

    it('PID が記録されていない場合は状態を削除する', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
        process: 'api',
        status: 'Running',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);

      await ProcessManager.stopProcess('workspace-1', 'api');

      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    });

    it('プロセスが既に死んでいる場合は状態を更新して終了する', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      vi.mocked(isPidAlive).mockReturnValue(false);

      await ProcessManager.stopProcess('workspace-1', 'api');

      expect(StateManager.writeState).toHaveBeenCalledWith(
        'workspace-1',
        'api',
        expect.objectContaining({
          status: 'Stopped',
          stoppedAt: expect.any(String),
        })
      );
      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-1', 'api');
      expect(PortManager.releaseReservationByProcess).toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    });

    it('SIGTERM 送信に失敗した場合はエラーを投げる', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
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

      await expect(ProcessManager.stopProcess('workspace-1', 'api')).rejects.toThrow(ProcessStopError);
    });

    it('タイムアウトした場合は SIGKILL を送信する', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
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
      await expect(ProcessManager.stopProcess('workspace-1', 'api', 100)).rejects.toThrow(ProcessStopError);

      expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
      // SIGKILL も呼ばれるはず（タイムアウト後）
      expect(kill).toHaveBeenCalledWith(1234, 'SIGKILL');
    });

    it('SIGKILL 送信後もプロセスが生存している場合はエラーを投げる', async () => {
      const state: ProcessState = {
        workspace: 'workspace-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(StateManager.readState).mockReturnValue(state);
      vi.mocked(isPidAlive).mockReturnValue(true); // 常に生存している
      vi.mocked(kill).mockReturnValue(true);

      await expect(ProcessManager.stopProcess('workspace-1', 'api', 100)).rejects.toThrow(ProcessStopError);
    });
  });

  describe('listProcesses', () => {
    it('すべてのプロセスの状態一覧を取得できる', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          workspaceKey: 'global-workspace-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
          logPath: '/path/to/log1.log',
        },
        {
          workspace: 'workspace-2',
          workspaceKey: 'global-workspace-2',
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
        workspace: 'workspace-1',
        workspaceKey: 'global-workspace-1',
        process: 'api',
        status: 'Running',
        pid: 1234,
        logPath: '/path/to/log1.log',
      });
      expect(processes[1]).toEqual({
        workspace: 'workspace-2',
        workspaceKey: 'global-workspace-2',
        process: 'worker',
        status: 'Running',
        pid: 5678,
        logPath: '/path/to/log2.log',
      });
    });

    it('死んでいるプロセスの状態を更新する', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          workspace: 'workspace-2',
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
        'workspace-2',
        'worker',
        expect.objectContaining({
          status: 'Stopped',
          stoppedAt: expect.any(String),
        })
      );
      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-2', 'worker');
    });

    it('PID がないプロセスはそのまま返す', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
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

    it('PID がない Running 状態のプロセスはそのまま返す', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
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
});
