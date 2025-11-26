import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';

import { homedir } from 'os';
import { join } from 'path';

/**
 * Process status values
 */
export type ProcessStatus = 'Running' | 'Stopped' | 'Error';

/**
 * Structure persisted for process state
 */
export interface ProcessState {
  group: string;
  groupKey?: string;
  groupLabel?: string;
  repositoryName?: string;
  groupDefinitionName?: string;
  worktreePath?: string;
  branch?: string;
  process: string;
  status: ProcessStatus;
  pid?: number;
  command?: string;
  error?: string;
  startedAt?: string; // ISO 8601 timestamp
  stoppedAt?: string; // ISO 8601 timestamp
  logPath?: string; // Path to the log file
  logMaxBytes?: number; // Maximum log size captured at start
  logsDisabled?: boolean; // Whether logging was disabled when started
  ports?: number[]; // Ports currently in use
}

function getPortmuxDir(): string {
  return join(homedir(), '.config', 'portmux');
}

/**
 * Base directory for state files
 */
export function getStateDir(): string {
  return join(getPortmuxDir(), 'state');
}

/**
 * Base directory for log files
 */
export function getLogDir(): string {
  return join(getPortmuxDir(), 'logs');
}

/**
 * Convert strings into filesystem-safe slugs.
 * Replace special characters with hyphens and collapse repeats.
 */
function slugify(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build the path to a state file
 */
function getStateFilePath(group: string, process: string): string {
  const groupSlug = slugify(group);
  const processSlug = slugify(process);
  const filename = `${groupSlug}-${processSlug}.json`;
  return join(getStateDir(), filename);
}

/**
 * Ensure the state directory exists
 */
function ensureStateDir(): void {
  const stateDir = getStateDir();
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Ensure the log directory exists
 */
function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Generate a log file path.
 * Filename format: <group-slug>-<process-slug>-<hash>.log
 */
function generateLogPath(group: string, process: string): string {
  ensureLogDir();

  const groupSlug = slugify(group);
  const processSlug = slugify(process);

  // Use a hash suffix to avoid collisions for identical names
  const hash = Date.now().toString(36);
  const filename = `${groupSlug}-${processSlug}-${hash}.log`;

  return join(getLogDir(), filename);
}

/**
 * Process state manager
 */
export const StateManager = {
  /**
   * Generate a log file path
   *
   * @param group Group name
   * @param process Process name
   * @returns Path to the log file
   */
  generateLogPath(group: string, process: string): string {
    return generateLogPath(group, process);
  },

  /**
   * Delete a log file safely
   *
   * @param logPath Absolute path to the log file
   */
  deleteLogFile(logPath: string): void {
    try {
      if (!logPath.startsWith(getLogDir())) {
        return;
      }

      if (existsSync(logPath)) {
        unlinkSync(logPath);
      }
    } catch {
      // Ignore errors when deleting log files
    }
  },

  /**
   * Delete log files that are not referenced by any provided states
   *
   * @param states List of states with potential logPath references
   */
  pruneLogs(states: ProcessState[]): void {
    const logDir = getLogDir();
    if (!existsSync(logDir)) {
      return;
    }

    const referenced = new Set(
      states.map((state) => state.logPath).filter((logPath): logPath is string => Boolean(logPath))
    );

    let files: string[];
    try {
      files = readdirSync(logDir);
    } catch {
      return;
    }

    for (const file of files) {
      const fullPath = join(logDir, file);
      if (referenced.has(fullPath)) {
        continue;
      }

      this.deleteLogFile(fullPath);
    }
  },

  /**
   * Read a process state
   *
   * @param group Group name
   * @param process Process name
   * @returns Process state or null when absent
   */
  readState(group: string, process: string): ProcessState | null {
    const filePath = getStateFilePath(group, process);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ProcessState;
    } catch {
      // Return null when the file is corrupted
      return null;
    }
  },

  /**
   * Persist a process state
   *
   * @param group Group name
   * @param process Process name
   * @param state Process state data
   */
  writeState(group: string, process: string, state: ProcessState): void {
    ensureStateDir();

    const filePath = getStateFilePath(group, process);
    const content = JSON.stringify(state, null, 2);
    writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 });
  },

  /**
   * Delete a stored state record
   *
   * @param group Group name
   * @param process Process name
   */
  deleteState(group: string, process: string): void {
    const filePath = getStateFilePath(group, process);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  },

  /**
   * Read every state file
   *
   * @returns Array of all process states
   */
  listAllStates(): ProcessState[] {
    ensureStateDir();

    const states: ProcessState[] = [];
    const stateDir = getStateDir();

    if (!existsSync(stateDir)) {
      return states;
    }

    try {
      const files = readdirSync(stateDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(stateDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const state = JSON.parse(content) as ProcessState;
          states.push(state);
        } catch {
          // Skip corrupted files
          continue;
        }
      }
    } catch {
      // Return an empty array when the directory cannot be read
      return states;
    }

    return states;
  },
};
