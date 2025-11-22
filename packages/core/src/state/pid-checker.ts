import { existsSync, readFileSync } from 'fs';

import { execSync } from 'child_process';
import { kill } from 'process';
import { platform } from 'os';

/**
 * Check whether the PID is alive.
 *
 * @param pid Process ID
 * @returns true if the process exists, false otherwise
 */
export function isPidAlive(pid: number): boolean {
  try {
    // Sending signal 0 only checks for the process without killing it
    // An error means the process does not exist
    kill(pid, 0);
    return true;
  } catch {
    // ESRCH (No such process) means the PID is gone
    return false;
  }
}

/**
 * Read the command line for a PID.
 *
 * @param pid Process ID
 * @returns Command line string, or null when unavailable
 */
export function getCommandLine(pid: number): string | null {
  const os = platform();

  try {
    if (os === 'linux') {
      // Linux: /proc/<pid>/cmdline
      const cmdlinePath = `/proc/${String(pid)}/cmdline`;
      if (!existsSync(cmdlinePath)) {
        return null;
      }

      const cmdline = readFileSync(cmdlinePath, 'utf-8');
      // Replace null separators with spaces
      return cmdline.replace(/\0/g, ' ').trim();
    } else if (os === 'darwin') {
      // macOS: ps -p <pid> -o command
      const output = execSync(`ps -p ${String(pid)} -o command=`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      return output.trim();
    } else if (os === 'win32') {
      // Windows: wmic process where ProcessId=<pid> get CommandLine
      const output = execSync(`wmic process where ProcessId=${String(pid)} get CommandLine`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      // Drop the header row
      const lines = output.split('\n').filter((line) => line.trim() && !line.startsWith('CommandLine'));
      return lines[0]?.trim() ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Verify that a PID was started by the expected command.
 * Comparing command lines helps detect PID reuse.
 *
 * @param pid Process ID
 * @param expectedCommand Command to compare against
 * @returns true when the commands match, false otherwise
 */
export function verifyPidCommand(pid: number, expectedCommand: string): boolean {
  const actualCommand = getCommandLine(pid);

  if (!actualCommand) {
    return false;
  }

  // Accept full or partial matches because shells may prepend wrappers like sh -c
  return actualCommand.includes(expectedCommand) || expectedCommand.includes(actualCommand);
}

/**
 * Check whether a PID is alive and optionally matches the expected command.
 *
 * @param pid Process ID
 * @param expectedCommand Expected command (omit to only check liveness)
 * @returns true when alive and matching, false otherwise
 */
export function isPidAliveAndValid(pid: number, expectedCommand?: string): boolean {
  // Check liveness first
  if (!isPidAlive(pid)) {
    return false;
  }

  // Verify the command only when provided
  if (expectedCommand) {
    return verifyPidCommand(pid, expectedCommand);
  }

  return true;
}

/**
 * Read the process start time.
 *
 * @param pid Process ID
 * @returns Date when the process started, or null if unavailable
 */
export function getProcessStartTime(pid: number): Date | null {
  const os = platform();

  try {
    if (os === 'win32') {
      const output = execSync(`wmic process where ProcessId=${String(pid)} get CreationDate`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const line = output
        .split('\n')
        .map((segment) => segment.trim())
        .find((segment) => /\d{14}\.?\d*/.test(segment));

      if (!line) {
        return null;
      }

      const [timestamp] = line.split('.');
      if (!timestamp || timestamp.length < 14) {
        return null;
      }

      const year = Number(timestamp.slice(0, 4));
      const month = Number(timestamp.slice(4, 6));
      const day = Number(timestamp.slice(6, 8));
      const hour = Number(timestamp.slice(8, 10));
      const minute = Number(timestamp.slice(10, 12));
      const second = Number(timestamp.slice(12, 14));

      if ([year, month, day, hour, minute, second].some((value) => Number.isNaN(value))) {
        return null;
      }

      return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    }

    const output = execSync(`ps -p ${String(pid)} -o lstart=`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        LC_ALL: 'C',
        LANG: 'C',
      },
    });

    const startString = output.trim();
    if (!startString) {
      return null;
    }

    const parsed = new Date(startString);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
