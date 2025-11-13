import { lock } from 'proper-lockfile';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

/**
 * ロックタイムアウトエラー
 */
export class LockTimeoutError extends Error {
  constructor(lockPath: string) {
    super(
      `ロックの取得がタイムアウトしました: ${lockPath}\n` +
        `他のプロセスがロックを保持している可能性があります。\n` +
        `しばらく待ってから再試行してください。`
    );
    this.name = 'LockTimeoutError';
  }
}

/**
 * ロック解放エラー
 */
export class LockReleaseError extends Error {
  constructor(lockPath: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`ロックの解放に失敗しました: ${lockPath}\n${message}`);
    this.name = 'LockReleaseError';
  }
}

/**
 * ロックの種類
 */
export type LockType = 'global' | 'workspace';

/**
 * ロック管理の設定
 */
const LOCK_TIMEOUT = 30000; // 30秒
const LOCK_BASE_DIR = join(homedir(), '.config', 'portmux', 'locks');

/**
 * ロックディレクトリを確保（存在しない場合は作成）
 */
function ensureLockDir(): void {
  if (!existsSync(LOCK_BASE_DIR)) {
    mkdirSync(LOCK_BASE_DIR, { recursive: true });
  }
}

/**
 * グローバルロックファイルのパスを取得
 */
function getGlobalLockPath(): string {
  ensureLockDir();
  const lockPath = join(LOCK_BASE_DIR, 'global.lock');

  // ロックファイルが存在しない場合は作成
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, '', 'utf-8');
  }

  return lockPath;
}

/**
 * ワークスペースロックファイルのパスを取得
 */
function getWorkspaceLockPath(workspace: string): string {
  ensureLockDir();

  // ワークスペース名をスラッグ化
  const slug = workspace
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const lockPath = join(LOCK_BASE_DIR, `${slug}.lock`);

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
   * ワークスペースロックを取得
   *
   * @param workspace ワークスペース名
   * @returns ロック解放関数
   * @throws LockTimeoutError タイムアウトした場合
   */
  async acquireWorkspaceLock(workspace: string): Promise<ReleaseLockFn> {
    const lockPath = getWorkspaceLockPath(workspace);

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
   * @param workspace ワークスペース名（ワークスペースロックの場合）
   * @param fn 実行する処理
   * @returns 処理の結果
   */
  async withLock<T>(
    lockType: LockType,
    workspace: string | null,
    fn: () => Promise<T>
  ): Promise<T> {
    let releaseLock: ReleaseLockFn;

    if (lockType === 'global') {
      releaseLock = await this.acquireGlobalLock();
    } else {
      if (!workspace) {
        throw new Error('ワークスペースロックの取得にはワークスペース名が必要です');
      }
      releaseLock = await this.acquireWorkspaceLock(workspace);
    }

    try {
      return await fn();
    } finally {
      await releaseLock();
    }
  },
};

