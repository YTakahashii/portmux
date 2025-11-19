import { existsSync, mkdirSync, writeFileSync } from 'fs';

import { homedir } from 'os';
import { join } from 'path';
import { lock } from 'proper-lockfile';
import { PortmuxError } from '../errors.js';

/**
 * Lock timeout error
 */
export class LockTimeoutError extends PortmuxError {
  override readonly name = 'LockTimeoutError';
  constructor(lockPath: string) {
    super(
      `Lock acquisition timed out: ${lockPath}\n` +
        `Another process may still hold the lock.\n` +
        `Please wait a moment and try again.`
    );
  }
}

/**
 * Lock release error
 */
export class LockReleaseError extends PortmuxError {
  override readonly name = 'LockReleaseError';
  constructor(lockPath: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to release lock: ${lockPath}\n${message}`);
  }
}

/**
 * Types of locks
 */
export type LockType = 'global' | 'group';

/**
 * Lock manager settings
 */
const LOCK_TIMEOUT = 30000; // 30 seconds

/**
 * Base directory for lock files
 */
function getLockBaseDir(): string {
  return join(homedir(), '.config', 'portmux', 'locks');
}

/**
 * Ensure the lock directory exists
 */
function ensureLockDir(): void {
  const lockBaseDir = getLockBaseDir();
  if (!existsSync(lockBaseDir)) {
    mkdirSync(lockBaseDir, { recursive: true });
  }
}

/**
 * Path to the global lock file
 */
function getGlobalLockPath(): string {
  ensureLockDir();
  const lockPath = join(getLockBaseDir(), 'global.lock');

  // Create the lock file if needed
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, '', 'utf-8');
  }

  return lockPath;
}

/**
 * Path to a group lock file
 */
function getGroupLockPath(group: string): string {
  ensureLockDir();

  // Slugify the group name
  const slug = group
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const lockPath = join(getLockBaseDir(), `${slug}.lock`);

  // Create the lock file if needed
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, '', 'utf-8');
  }

  return lockPath;
}

/**
 * Type for functions that release a lock
 */
export type ReleaseLockFn = () => Promise<void>;

/**
 * Lock manager
 */
export const LockManager = {
  /**
   * Acquire the global lock
   *
   * @returns Release function for the lock
   * @throws LockTimeoutError When acquisition times out
   */
  async acquireGlobalLock(): Promise<ReleaseLockFn> {
    const lockPath = getGlobalLockPath();

    try {
      const releaseFn = await lock(lockPath, {
        retries: {
          retries: 10,
          minTimeout: 100,
          maxTimeout: 3000,
        },
        stale: LOCK_TIMEOUT,
      });

      return async () => {
        try {
          await releaseFn();
        } catch (error) {
          throw new LockReleaseError(lockPath, error);
        }
      };
    } catch {
      throw new LockTimeoutError(lockPath);
    }
  },

  /**
   * Acquire a group lock
   *
   * @param group Group name
   * @returns Release function for the lock
   * @throws LockTimeoutError When acquisition times out
   */
  async acquireGroupLock(group: string): Promise<ReleaseLockFn> {
    const lockPath = getGroupLockPath(group);

    try {
      const releaseFn = await lock(lockPath, {
        retries: {
          retries: 10,
          minTimeout: 100,
          maxTimeout: 3000,
        },
        stale: LOCK_TIMEOUT,
      });

      return async () => {
        try {
          await releaseFn();
        } catch (error) {
          throw new LockReleaseError(lockPath, error);
        }
      };
    } catch {
      throw new LockTimeoutError(lockPath);
    }
  },

  /**
   * Run a function within a lock.
   * Always release the lock after the handler completes.
   *
   * @param lockType Lock type
   * @param group Group name (required for group locks)
   * @param fn Handler to execute
   * @returns Result of the handler
   */
  async withLock<T>(lockType: LockType, group: string | null, fn: () => Promise<T>): Promise<T> {
    let releaseLock: ReleaseLockFn;

    if (lockType === 'global') {
      releaseLock = await this.acquireGlobalLock();
    } else {
      if (!group) {
        throw new Error('Group name is required to acquire a group lock');
      }
      releaseLock = await this.acquireGroupLock(group);
    }

    try {
      return await fn();
    } finally {
      await releaseLock();
    }
  },
};
