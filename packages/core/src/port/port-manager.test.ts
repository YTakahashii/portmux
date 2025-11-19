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
    it('does not throw when every port is available', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);

      await expect(PortManager.checkPortAvailability([3000, 3001, 3002])).resolves.toBeUndefined();
    });

    it('throws PortInUseError when a port is in use', async () => {
      vi.mocked(checkPortUsed).mockImplementation((port) => {
        return Promise.resolve(typeof port === 'number' ? port === 3001 : false);
      });

      await expect(PortManager.checkPortAvailability([3000, 3001, 3002])).rejects.toThrow(PortInUseError);
    });

    it('throws for the first port when multiple ports are busy', async () => {
      vi.mocked(checkPortUsed).mockImplementation((port) => {
        return Promise.resolve(typeof port === 'number' ? port === 3000 || port === 3001 : false);
      });

      await expect(PortManager.checkPortAvailability([3000, 3001, 3002])).rejects.toThrow(new PortInUseError(3000));
    });
  });

  describe('loadReservationsFromState', () => {
    it('loads port reservation data from the state store', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
          ports: [3000],
        },
        {
          group: 'group-2',
          process: 'worker',
          status: 'Running',
          pid: 5678,
          startedAt: '2024-01-01T01:00:00.000Z',
          ports: [4000, 4001],
        },
        {
          group: 'group-3',
          process: 'api',
          status: 'Stopped',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(2);
      expect(reservations.get('group-1:api')).toEqual({
        group: 'group-1',
        process: 'api',
        ports: [3000],
        pid: 1234,
        reservedAt: '2024-01-01T00:00:00.000Z',
        startedAt: '2024-01-01T00:00:00.000Z',
      });
      expect(reservations.get('group-2:worker')).toEqual({
        group: 'group-2',
        process: 'worker',
        ports: [4000, 4001],
        pid: 5678,
        reservedAt: '2024-01-01T01:00:00.000Z',
        startedAt: '2024-01-01T01:00:00.000Z',
      });
    });

    it('ignores processes that are not in Running status', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Stopped',
        },
        {
          group: 'group-2',
          process: 'worker',
          status: 'Error',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(0);
    });

    it('skips Running processes without a PID', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Running',
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(0);
    });

    it('defaults startedAt to now when missing', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
        },
      ];

      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const reservations = PortManager.loadReservationsFromState();

      expect(reservations.size).toBe(1);
      const reservation = reservations.get('group-1:api');
      expect(reservation).toBeDefined();
      expect(reservation?.reservedAt).toBeDefined();
      expect(reservation?.startedAt).toBeUndefined();
    });
  });

  describe('reconcileFromState', () => {
    it('releases reservations whose PIDs are dead', () => {
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
      vi.mocked(isPidAlive).mockImplementation((pid: number) => {
        return pid === 1234;
      });

      PortManager.reconcileFromState();

      expect(StateManager.deleteState).toHaveBeenCalledTimes(1);
      expect(StateManager.deleteState).toHaveBeenCalledWith('group-2', 'worker');
    });

    it('keeps reservations when the PID is still alive', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
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

    it('does not release reservations without a PID', () => {
      const states: ProcessState[] = [
        {
          group: 'group-1',
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
    it('plans a new port reservation', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        group: 'group-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(plan.reservationToken).toBeDefined();
      expect(plan.reservationToken).toMatch(/^[0-9a-f]{32}$/);
      expect(plan.warnings).toEqual([]);
    });

    it('adds a warning when a process already exists', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      const states: ProcessState[] = [
        {
          group: 'group-1',
          process: 'api',
          status: 'Running',
          pid: 1234,
          startedAt: '2024-01-01T00:00:00.000Z',
        },
      ];
      vi.mocked(StateManager.listAllStates).mockReturnValue(states);

      const request = {
        group: 'group-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain('already running');
    });

    it('throws PortInUseError when a port is in use', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(true);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        group: 'group-1',
        process: 'api',
        ports: [3000],
      };

      await expect(PortManager.planReservation(request)).rejects.toThrow(PortInUseError);
    });
  });

  describe('commitReservation', () => {
    it('commits a reservation with a valid token', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        group: 'group-1',
        process: 'api',
        ports: [3000, 3001],
      };

      const plan = await PortManager.planReservation(request);

      expect(() => {
        PortManager.commitReservation(plan.reservationToken);
      }).not.toThrow();
    });

    it('throws for an invalid reservation token', () => {
      expect(() => {
        PortManager.commitReservation('invalid-token');
      }).toThrow('Invalid reservation token: invalid-token');
    });
  });

  describe('releaseReservation', () => {
    it('releases a reservation using its token', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const request = {
        group: 'group-1',
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
      }).toThrow('Invalid reservation token');
    });

    it('does nothing when no reservation token is provided', () => {
      expect(() => {
        PortManager.releaseReservation();
      }).not.toThrow();
    });
  });

  describe('releaseReservationByProcess', () => {
    it('releases the target reservation and deletes its state', async () => {
      vi.mocked(checkPortUsed).mockResolvedValue(false);
      vi.mocked(StateManager.listAllStates).mockReturnValue([]);

      const plan = await PortManager.planReservation({
        group: 'group-1',
        process: 'api',
        ports: [3000],
      });

      PortManager.releaseReservationByProcess('group-1', 'api');

      expect(() => {
        PortManager.commitReservation(plan.reservationToken);
      }).toThrow('Invalid reservation token');
      expect(StateManager.deleteState).toHaveBeenCalledWith('group-1', 'api');
    });
  });

  describe('PortInUseError', () => {
    it('constructs PortInUseError properly', () => {
      const error = new PortInUseError(3000);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('PortInUseError');
      expect(error.message).toBe('Port 3000 is already in use');
    });
  });
});
