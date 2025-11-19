import { StateManager } from '../state/state-manager.js';
import { check as checkPortUsed } from 'tcp-port-used';
import { isPidAlive } from '../state/pid-checker.js';
import { randomBytes } from 'crypto';
import { PortmuxError } from '../errors.js';

/**
 * Error thrown when a port is already in use
 */
export class PortInUseError extends PortmuxError {
  override readonly name = 'PortInUseError';
  constructor(port: number) {
    super(`Port ${String(port)} is already in use`);
  }
}

/**
 * Port reservation request
 */
export interface PortReservationRequest {
  group: string;
  process: string;
  ports: number[];
}

/**
 * Port reservation plan
 */
export interface PortReservationPlan {
  reservationToken: string;
  warnings: string[];
}

/**
 * Port reservation metadata
 */
export interface PortReservationMetadata {
  pid: number;
  startedAt: string;
}

/**
 * Port reservation info persisted in the state store
 */
export interface PortReservation {
  group: string;
  process: string;
  ports: number[];
  pid?: number;
  reservedAt: string;
  startedAt?: string;
}

/**
 * Pending port reservations that live until commit
 */
const pendingReservations = new Map<string, PortReservation>();

/**
 * Port management object
 */
export const PortManager = {
  /**
   * Check whether the requested ports are available
   *
   * @param ports Array of ports to check
   * @throws PortInUseError When a requested port is already in use
   */
  async checkPortAvailability(ports: number[]): Promise<void> {
    const unavailablePorts: number[] = [];

    for (const port of ports) {
      const inUse = await checkPortUsed(port);
      if (inUse) {
        unavailablePorts.push(port);
      }
    }

    if (unavailablePorts.length > 0) {
      const firstPort = unavailablePorts[0];
      if (firstPort !== undefined) {
        throw new PortInUseError(firstPort);
      }
    }
  },

  /**
   * Verify that existing state does not conflict with the request
   */
  checkReservationConflicts(existing: Map<string, PortReservation>, request: PortReservationRequest): void {
    for (const reservation of existing.values()) {
      const conflictPort = reservation.ports.find((port) => request.ports.includes(port));
      if (conflictPort !== undefined) {
        throw new PortInUseError(conflictPort);
      }
    }
  },

  /**
   * Load port reservation info from the state store
   */
  loadReservationsFromState(): Map<string, PortReservation> {
    const reservations = new Map<string, PortReservation>();
    const states = StateManager.listAllStates();

    for (const state of states) {
      if (state.status === 'Running' && state.pid) {
        const ports: number[] = state.ports ?? [];
        const reservation: PortReservation = {
          group: state.group,
          process: state.process,
          ports,
          pid: state.pid,
          reservedAt: state.startedAt ?? new Date().toISOString(),
          ...(state.startedAt && { startedAt: state.startedAt }),
        };
        const key = `${state.group}:${state.process}`;
        reservations.set(key, reservation);
      }
    }

    return reservations;
  },

  /**
   * Release orphaned port reservations when the PID has died
   */
  reconcileFromState(): void {
    const reservations = this.loadReservationsFromState();

    for (const reservation of reservations.values()) {
      if (reservation.pid && !isPidAlive(reservation.pid)) {
        // Remove the state when its PID is no longer alive
        StateManager.deleteState(reservation.group, reservation.process);
      }
    }
  },

  /**
   * Plan a port reservation (two-phase commit phase 1)
   *
   * @param request Port reservation request
   * @returns Port reservation plan
   * @throws PortInUseError When a requested port is already in use
   */
  async planReservation(request: PortReservationRequest): Promise<PortReservationPlan> {
    const warnings: string[] = [];

    // Check port availability
    await this.checkPortAvailability(request.ports);

    // Load existing reservations from the state store
    const existingReservations = this.loadReservationsFromState();
    const existingKey = `${request.group}:${request.process}`;
    const existingReservation = existingReservations.get(existingKey);

    if (existingReservation) {
      warnings.push(
        `Process "${request.process}" is already running.` + ` Stop the existing process before starting it again.`
      );
    }

    // Ensure there are no conflicts with existing reservations
    this.checkReservationConflicts(existingReservations, request);

    // Generate a reservation token
    const reservationToken = randomBytes(16).toString('hex');

    // Create a pending reservation entry
    const reservation: PortReservation = {
      group: request.group,
      process: request.process,
      ports: request.ports,
      reservedAt: new Date().toISOString(),
    };

    pendingReservations.set(reservationToken, reservation);

    return {
      reservationToken,
      warnings,
    };
  },

  /**
   * Commit the reservation (two-phase commit phase 2)
   *
   * @param reservationToken Reservation token
   */
  commitReservation(reservationToken: string): void {
    const reservation = pendingReservations.get(reservationToken);
    if (!reservation) {
      throw new Error(`Invalid reservation token: ${reservationToken}`);
    }

    // StateManager currently persists the state for us
    // We may store explicit port info there in the future

    // Remove the pending reservation
    pendingReservations.delete(reservationToken);
  },

  /**
   * Release a pending reservation
   *
   * @param reservationToken Reservation token (only for pending reservations)
   */
  releaseReservation(reservationToken?: string): void {
    if (reservationToken) {
      pendingReservations.delete(reservationToken);
    }
  },

  /**
   * Release a reservation by group and process names
   */
  releaseReservationByProcess(group: string, process: string): void {
    // Remove pending reservations
    for (const [token, reservation] of pendingReservations.entries()) {
      if (reservation.group === group && reservation.process === process) {
        pendingReservations.delete(token);
      }
    }

    // Remove the entry from the state store because StateManager retains it
    StateManager.deleteState(group, process);
  },
};
