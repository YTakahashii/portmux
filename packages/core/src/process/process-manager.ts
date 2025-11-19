import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { kill } from 'process';
import { StateManager, type ProcessState, type ProcessStatus } from '../state/state-manager.js';
import { isPidAlive } from '../state/pid-checker.js';
import { ConfigManager } from '../config/config-manager.js';
import { PortManager } from '../port/port-manager.js';
import { openSync, closeSync } from 'fs';
import { PortmuxError } from '../errors.js';

/**
 * Process start options
 */
export interface ProcessStartOptions {
  cwd?: string;
  env?: Record<string, string>;
  projectRoot?: string; // Directory containing portmux.config.json
  ports?: number[]; // Array of ports to reserve
  groupKey?: string; // Repository path (from global config) for display
}

/** Process start error */
export class ProcessStartError extends PortmuxError {
  override readonly name = 'ProcessStartError';
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
  }
}

/** Process stop error */
export class ProcessStopError extends PortmuxError {
  override readonly name = 'ProcessStopError';
}

/** Process restart error */
export class ProcessRestartError extends PortmuxError {
  override readonly name = 'ProcessRestartError';
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * Process state info
 */
export interface ProcessInfo {
  group: string;
  groupKey?: string;
  process: string;
  status: ProcessStatus;
  pid?: number;
  logPath?: string;
}

/**
 * Process management object
 */
export const ProcessManager = {
  /**
   * Start a process
   *
   * @param group Group name
   * @param processName Process name
   * @param command Command to execute
   * @param options Start options
   * @throws ProcessStartError When the start fails
   */
  async startProcess(
    group: string,
    processName: string,
    command: string,
    options: ProcessStartOptions = {}
  ): Promise<void> {
    // Ensure the state store and active reservations are in sync
    PortManager.reconcileFromState();

    // Plan port reservations
    let reservationToken: string | undefined;
    if (options.ports && options.ports.length > 0) {
      try {
        const plan = await PortManager.planReservation({
          group,
          process: processName,
          ports: options.ports,
        });

        reservationToken = plan.reservationToken;

        // Surface any warnings
        for (const warning of plan.warnings) {
          console.warn(`Warning: ${warning}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new ProcessStartError(`Failed to reserve ports: ${error.message}`, error);
        }
        throw error;
      }
    }

    // Check whether the process is already running
    const existingState = StateManager.readState(group, processName);
    if (existingState?.status === 'Running') {
      if (existingState.pid && isPidAlive(existingState.pid)) {
        // Release reserved ports
        if (reservationToken) {
          PortManager.releaseReservation(reservationToken);
        }
        throw new ProcessStartError(`Process "${processName}" is already running (PID: ${String(existingState.pid)})`);
      } else {
        // Clean up stale state for dead PIDs
        StateManager.deleteState(group, processName);
      }
    }

    // Determine the project root (from the config file)
    let projectRoot = options.projectRoot;
    if (!projectRoot) {
      try {
        const configPath = ConfigManager.findConfigFile();
        projectRoot = resolve(configPath, '..');
      } catch (error) {
        throw new ProcessStartError('Config file not found. Please specify projectRoot.', error);
      }
    }

    // Resolve cwd (relative paths are based on the project root)
    let cwd = projectRoot;
    if (options.cwd) {
      if (options.cwd.startsWith('/')) {
        cwd = options.cwd;
      } else {
        cwd = resolve(projectRoot, options.cwd);
      }
    }

    // Merge environment variables
    // options.env contains env vars defined in the config file
    // ConfigManager resolves their values before passing them here
    const env = {
      ...process.env,
      ...options.env,
    };

    // Prepare the log file
    const logPath = StateManager.generateLogPath(group, processName);

    // Open the log file descriptor
    let logFd: number;
    try {
      logFd = openSync(logPath, 'a', 0o600);
    } catch (error) {
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError(`Failed to create log file: ${logPath}`, error);
    }

    // Spawn the child process through the shell
    let childProcess: ChildProcess;
    try {
      // The shell option allows complex commands (quotes, pipes, etc.)
      childProcess = spawn(command, {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', logFd, logFd], // Write stdout/stderr directly into the log file
        shell: true, // Run via shell
      });

      // Detach the child into its own process group
      childProcess.unref();
      // Close the parent's log file descriptor
      closeSync(logFd);
    } catch (error) {
      closeSync(logFd);
      // Release reserved ports on failure
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError(`Failed to start process: ${command}`, error);
    }

    // Capture the PID
    const pid = childProcess.pid;
    if (!pid) {
      // Release reserved ports
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError('Failed to determine process PID');
    }

    // Confirm the process is running (wait 2s and verify the PID)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!isPidAlive(pid)) {
      // Release reserved ports
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError(`Process exited immediately after launch (PID: ${String(pid)})`);
    }

    const startedAt = new Date().toISOString();

    // Commit the port reservation
    if (reservationToken) {
      PortManager.commitReservation(reservationToken);
    }

    // Persist the state
    const state: ProcessState = {
      group,
      groupKey: options.groupKey ?? group,
      process: processName,
      status: 'Running',
      pid,
      startedAt,
      logPath,
      ...(options.ports !== undefined && { ports: options.ports }),
    };
    StateManager.writeState(group, processName, state);
  },

  /**
   * Stop a process
   *
   * @param group Group name
   * @param processName Process name
   * @param timeout Timeout in milliseconds (default: 10000)
   * @throws ProcessStopError When the stop fails
   */
  async stopProcess(group: string, processName: string, timeout = 10000): Promise<void> {
    const state = StateManager.readState(group, processName);
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      PortManager.releaseReservationByProcess(group, processName);
      cleaned = true;
    };

    if (!state) {
      throw new ProcessStopError(`State for process "${processName}" was not found`);
    }

    try {
      if (state.status === 'Stopped') {
        // Remove the state when it is already stopped
        StateManager.deleteState(group, processName);
        cleanup();
        return;
      }

      if (!state.pid) {
        // Without a recorded PID just remove the state
        StateManager.deleteState(group, processName);
        cleanup();
        return;
      }

      const pid = state.pid;

      // Update the state when the process is already dead
      if (!isPidAlive(pid)) {
        const stoppedState: ProcessState = {
          ...state,
          status: 'Stopped',
          stoppedAt: new Date().toISOString(),
        };
        StateManager.writeState(group, processName, stoppedState);
        // Remove state files for stopped processes
        StateManager.deleteState(group, processName);
        cleanup();
        return;
      }

      // Send SIGTERM
      try {
        kill(pid, 'SIGTERM');
      } catch {
        throw new ProcessStopError(`Failed to send SIGTERM to process "${processName}" (PID: ${String(pid)})`);
      }

      // Wait for the process to stop (up to timeout ms)
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        if (!isPidAlive(pid)) {
          // Process exited
          const stoppedState: ProcessState = {
            ...state,
            status: 'Stopped',
            stoppedAt: new Date().toISOString(),
          };
          StateManager.writeState(group, processName, stoppedState);
          // Delete the state file
          StateManager.deleteState(group, processName);
          cleanup();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100 ms
      }

      // Send SIGKILL if the timeout expired
      try {
        kill(pid, 'SIGKILL');
      } catch {
        // Even if SIGKILL fails, the process might have exited already
      }

      // Final check
      if (!isPidAlive(pid)) {
        const stoppedState: ProcessState = {
          ...state,
          status: 'Stopped',
          stoppedAt: new Date().toISOString(),
        };
        StateManager.writeState(group, processName, stoppedState);
        StateManager.deleteState(group, processName);
        cleanup();
      } else {
        throw new ProcessStopError(
          `Failed to stop process "${processName}" (PID: ${String(pid)}).` +
            'The process did not exit even after SIGKILL.'
        );
      }
    } finally {
      cleanup();
    }
  },

  /**
   * List every process state
   *
   * @returns Array of process info
   */
  listProcesses(): ProcessInfo[] {
    const states = StateManager.listAllStates();
    const processes: ProcessInfo[] = [];

    for (const state of states) {
      // Confirm the PID is still alive
      let status: ProcessStatus = state.status;
      if (state.status === 'Running' && state.pid) {
        if (!isPidAlive(state.pid)) {
          // Update the state when the process is dead
          const updatedState: ProcessState = {
            ...state,
            status: 'Stopped',
            stoppedAt: new Date().toISOString(),
          };
          StateManager.writeState(state.group, state.process, updatedState);
          // Remove the stale state file
          StateManager.deleteState(state.group, state.process);
          status = 'Stopped';
        }
      }

      processes.push({
        group: state.group,
        ...(state.groupKey !== undefined && { groupKey: state.groupKey }),
        process: state.process,
        status,
        ...(state.pid !== undefined && { pid: state.pid }),
        ...(state.logPath !== undefined && { logPath: state.logPath }),
      });
    }

    return processes;
  },

  /**
   * Restart a process
   *
   * @param group Group name
   * @param processName Process name
   * @param command Command to execute
   * @param options Start options
   * @throws ProcessRestartError When the restart fails
   */
  async restartProcess(
    group: string,
    processName: string,
    command: string,
    options: ProcessStartOptions = {}
  ): Promise<void> {
    const restartPlan = {
      previousState: StateManager.readState(group, processName),
    };

    try {
      if (restartPlan.previousState) {
        await this.stopProcess(group, processName);
      }
    } catch (error) {
      throw new ProcessRestartError(`Failed to stop process "${processName}"`, error);
    }

    try {
      await this.startProcess(group, processName, command, options);
    } catch (error) {
      const errorState: ProcessState = {
        group,
        groupKey: options.groupKey ?? restartPlan.previousState?.groupKey ?? group,
        process: processName,
        status: 'Error',
        error: error instanceof Error ? error.message : String(error),
        ...(restartPlan.previousState?.logPath !== undefined && { logPath: restartPlan.previousState.logPath }),
        ...(restartPlan.previousState?.ports !== undefined && { ports: restartPlan.previousState.ports }),
      };
      StateManager.writeState(group, processName, errorState);
      throw new ProcessRestartError(`Failed to restart process "${processName}"`, error);
    }
  },
};
