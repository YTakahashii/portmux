import { PortManager, PortInUseError } from './port-manager.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir as systemTmpdir } from 'node:os';
import { StateManager, type ProcessState } from '../state/state-manager.js';
import { check as checkPortUsed } from 'tcp-port-used';
import { isPidAlive } from '../state/pid-checker.js';

const testHomeDir = mkdtempSync(join(systemTmpdir(), 'portmux-port-home-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: (): string => testHomeDir,
  };
});

vi.mock('tcp-port-used', async () => {
  const actual = await vi.importActual<typeof import('tcp-port-used')>('tcp-port-used');
  return {
    ...actual,
    check: vi.fn(),
  };
});

vi.mock('../state/state-manager.js', async () => {
  const actual = await vi.importActual<typeof import('../state/state-manager.js')>('../state/state-manager.js');
  return {
    ...actual,
    StateManager: {
      ...actual.StateManager,
      listAllStates: vi.fn(),
      deleteState: vi.fn(),
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

describe('PortManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(checkPortUsed).mockClear();
    vi.mocked(StateManager.listAllStates).mockClear();
    vi.mocked(StateManager.deleteState).mockClear();
    vi.mocked(isPidAlive).mockClear();
  });

  afterAll(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
  });

  describe('checkPortAvailability', () => {
    it('すべてのポートが使用可能な場合はエラーを投げない', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);

      await expect(PortManager.checkPortAvailability([3000, 3001, 3002])).resolves.toBeUndefined();
    });

    it('ポートが使用中の場合は PortInUseError を投げる', async () => {
      vi.mocked(checkPortUsed).mockImplementation((port: number) => {
        return Promise.resolve(port === 3001);
      });

      await expect(PortManager.checkPortAvailability([3000, 3001, 3002])).rejects.toThrow(PortInUseError);
    });

    it('複数のポートが使用中の場合、最初のポートでエラーを投げる', async () => {
      vi.mocked(checkPortUsed).mockImplementation((port: number) => {
        return Promise.resolve(port === 3000 || port === 3001);
      });

      await expect(PortManager.checkPortAvailability([3000, 3001, 3002])).rejects.toThrow(new PortInUseError(3000));
    });
  });

  describe('loadReservationsFromState', () => {
    it('状態ストアからポート予約情報を読み込む', () => {
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
        {
          workspace: 'workspace-3',
          process: 'api',
          status: 'Stopped',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(2);
      expect(reservations.get('workspace-1:api')).toEqual({
        workspace: 'workspace-1',
        process: 'api',
        ports: [],
        pid: 1234,
        reservedAt: '2024-01-01T00:00:00.000Z',
        startedAt: '2024-01-01T00:00:00.000Z',
      });
      expect(reservations.get('workspace-2:worker')).toEqual({
        workspace: 'workspace-2',
        process: 'worker',
        ports: [],
        pid: 5678,
        reservedAt: '2024-01-01T01:00:00.000Z',
        startedAt: '2024-01-01T01:00:00.000Z',
      });
    });

    it('Running 状態でないプロセスは読み込まない', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Stopped',
        },
        {
          workspace: 'workspace-2',
          process: 'worker',
          status: 'Error',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(0);
    });

    it('PID がない Running 状態のプロセスは読み込まない', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Running',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(0);
    });

    it('startedAt がない場合は現在時刻を使用する', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(1);
      const reservation = reservations.get('workspace-1:api');
      expect(reservation).toBeDefined();
      expect(reservation?.reservedAt).toBeDefined();
      expect(reservation?.startedAt).toBeUndefined();
    });
  });

  describe('reconcileFromState', () => {
    it('PID が死んでいる予約を解放する', () => {
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
      vi.mocked(isPidAlive).mockImplementation((pid: number) => {
        return pid === 1234;
      });

      PortManager.reconcileFromState();

      expect(StateManager.deleteState).toHaveBeenCalledTimes(1);
      expect(StateManager.deleteState).toHaveBeenCalledWith('workspace-2', 'worker');
    });

    it('PID が生存している予約は解放しない', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);
      vi.mocked(isPidAlive).mockReturnValue(true);

      PortManager.reconcileFromState();

      expect(StateManager.deleteState).not.toHaveBeenCalled();
    });

    it('PID がない予約は解放しない', () => {
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Running',
          startedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      PortManager.reconcileFromState();

      expect(isPidAlive).not.toHaveBeenCalled();
      expect(StateManager.deleteState).not.toHaveBeenCalled();
    });
  });

  describe('planReservation', () => {
    it('ポート予約の計画を立てる', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        workspace: 'workspace-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(plan.reservationToken).toBeDefined();
      expect(plan.reservationToken).toMatch(/^[0-9a-f]{32}$/);
      expect(plan.warnings).toEqual([]);
    });

    it('既存のプロセスがある場合は警告を追加する', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      const states: ProcessState[] = [
        {
          workspace: 'workspace-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
        },
      ];
      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const request = {
        workspace: 'workspace-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain('既に起動しています');
    });

    it('ポートが使用中の場合は PortInUseError を投げる', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(true);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        workspace: 'workspace-1',
        process: 'api',
        ports: [3000],
      };

      await expect(PortManager.planReservation(request)).rejects.toThrow(PortInUseError);
    });
  });

  describe('commitReservation', () => {
    it('有効な予約トークンで予約を確定できる', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        workspace: 'workspace-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(() => {
        PortManager.commitReservation(plan.reservationToken);
      }).not.toThrow();
    });

    it('無効な予約トークンでエラーを投げる', () => {
      expect(() => {
        PortManager.commitReservation('invalid-token');
      }).toThrow('無効な予約トークンです: invalid-token');
    });
  });

  describe('releaseReservation', () => {
    it('予約トークンを指定して予約を解放できる', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        workspace: 'workspace-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(() => {
        PortManager.releaseReservation(plan.reservationToken);
      }).not.toThrow();

      // 解放後は commit できないことを確認
      expect(() => {
        PortManager.commitReservation(plan.reservationToken);
      }).toThrow('無効な予約トークンです');
    });

    it('予約トークンを指定しない場合は何もしない', () => {
      expect(() => {
        PortManager.releaseReservation();
      }).not.toThrow();
    });
  });

  describe('releaseReservationByProcess', () => {
    it('実装が空であることを確認', () => {
      expect(() => {
        PortManager.releaseReservationByProcess();
      }).not.toThrow();
    });
  });

  describe('PortInUseError', () => {
    it('PortInUseError が正しく作成される', () => {
      const error = new PortInUseError(3000);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('PortInUseError');
      expect(error.message).toBe('ポート 3000 は既に使用されています');
    });
  });
});
