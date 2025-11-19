import { existsSync, mkdirSync, writeFileSync } from 'fs';

import { homedir } from 'os';
import { join } from 'path';
import { lock } from 'proper-lockfile';
import { PortmuxError } from '../errors.js';

/**
 * ロックタイムアウトエラー
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
 * ロック解放エラー
 */
export class LockReleaseError extends PortmuxError {
  override readonly name = 'LockReleaseError';
  constructor(lockPath: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to release lock: ${lockPath}\n${message}`);
  }
}

/**
 * ロックの種類
 */
export type LockType = 'global' | 'group';

/**
 * ロック管理の設定
 */
const LOCK_TIMEOUT = 30000; // 30秒

/**
 * ロックベースディレクトリのパスを取得
 */
function getLockBaseDir(): string {
  return join(homedir(), '.config', 'portmux', 'locks');
}

/**
 * ロックディレクトリを確保（存在しない場合は作成）
 */
function ensureLockDir(): void {
  const lockBaseDir = getLockBaseDir();
  if (!existsSync(lockBaseDir)) {
    mkdirSync(lockBaseDir, { recursive: true });
  }
}

/**
 * グローバルロックファイルのパスを取得
 */
function getGlobalLockPath(): string {
  ensureLockDir();
  const lockPath = join(getLockBaseDir(), 'global.lock');

  // ロックファイルが存在しない場合は作成
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, '', 'utf-8');
  }

  return lockPath;
}

/**
 * グループロックファイルのパスを取得
 */
function getGroupLockPath(group: string): string {
  ensureLockDir();

  // グループ名をスラッグ化
  const slug = group
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const lockPath = join(getLockBaseDir(), `${slug}.lock`);

  // ロックファイルが存在しない場合は作成
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, '', 'utf-8');
  }

  return lockPath;
}

/**
 * ロック解放関数の型
 */
export type ReleaseLockFn = () => Promise<void>;

/**
 * ロック管理を行うオブジェクト
 */
export const LockManager = {
  /**
   * グローバルロックを取得
   *
   * @returns ロック解放関数
   * @throws LockTimeoutError タイムアウトした場合
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
   * グループロックを取得
   *
   * @param group グループ名
   * @returns ロック解放関数
   * @throws LockTimeoutError タイムアウトした場合
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
   * ロックされた処理を実行
   * ロックを取得してから処理を実行し、最後に必ずロックを解放する
   *
   * @param lockType ロックの種類
   * @param group グループ名（グループロックの場合）
   * @param fn 実行する処理
   * @returns 処理の結果
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
