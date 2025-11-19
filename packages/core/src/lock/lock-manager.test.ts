import { LockManager, LockReleaseError, LockTimeoutError } from './lock-manager.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';

import { homedir } from 'os';
import { join } from 'path';
import { lock } from 'proper-lockfile';
import { tmpdir as systemTmpdir } from 'node:os';

const testHomeDir = mkdtempSync(join(systemTmpdir(), 'portmux-lock-home-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: (): string => testHomeDir,
  };
});

vi.mock('proper-lockfile', async () => {
  const actual = await vi.importActual<typeof import('proper-lockfile')>('proper-lockfile');
  return {
    ...actual,
    lock: vi.fn(),
  };
});

function getLockDir(): string {
  return join(homedir(), '.config', 'portmux', 'locks');
}

describe('LockManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const lockDir = getLockDir();
    rmSync(lockDir, { recursive: true, force: true });
    vi.mocked(lock).mockClear();
    // デフォルトでは実際の lock 関数を使う
    vi.mocked(lock).mockImplementation(async (path: string) => {
      const actual = await vi.importActual<typeof import('proper-lockfile')>('proper-lockfile');
      const result = await actual.lock(path, {
        retries: {
          retries: 10,
          minTimeout: 100,
          maxTimeout: 3000,
        },
        stale: 30000,
      });
      return result;
    });
  });

  afterAll(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
  });

  describe('acquireGlobalLock', () => {
    it('acquires the global lock', async () => {
      const releaseLock = await LockManager.acquireGlobalLock();

      expect(releaseLock).toBeInstanceOf(Function);
      expect(existsSync(join(getLockDir(), 'global.lock'))).toBe(true);

      await releaseLock();
    });

    it('releases the global lock', async () => {
      const releaseLock = await LockManager.acquireGlobalLock();

      await expect(releaseLock()).resolves.toBeUndefined();
    });

    it('creates the lock directory when acquiring the global lock', async () => {
      const lockDir = getLockDir();
      expect(existsSync(lockDir)).toBe(false);

      const releaseLock = await LockManager.acquireGlobalLock();

      expect(existsSync(lockDir)).toBe(true);
      expect(existsSync(join(lockDir, 'global.lock'))).toBe(true);

      await releaseLock();
    });
  });

  describe('acquireGroupLock', () => {
    it('acquires a group lock', async () => {
      const group = 'test-group';
      const releaseLock = await LockManager.acquireGroupLock(group);

      expect(releaseLock).toBeInstanceOf(Function);
      expect(existsSync(join(getLockDir(), 'test-group.lock'))).toBe(true);

      await releaseLock();
    });

    it('releases a group lock', async () => {
      const group = 'test-group';
      const releaseLock = await LockManager.acquireGroupLock(group);

      await expect(releaseLock()).resolves.toBeUndefined();
    });

    it('slugifies the group name when creating the lock file', async () => {
      const lockDir = getLockDir();
      const releaseLock1 = await LockManager.acquireGroupLock('My Group');
      expect(existsSync(join(lockDir, 'My-Group.lock'))).toBe(true);
      await releaseLock1();

      const releaseLock2 = await LockManager.acquireGroupLock('group/with/slashes');
      expect(existsSync(join(lockDir, 'group-with-slashes.lock'))).toBe(true);
      await releaseLock2();

      const releaseLock3 = await LockManager.acquireGroupLock('group---with---dashes');
      expect(existsSync(join(lockDir, 'group-with-dashes.lock'))).toBe(true);
      await releaseLock3();

      const releaseLock4 = await LockManager.acquireGroupLock('-group-');
      expect(existsSync(join(lockDir, 'group.lock'))).toBe(true);
      await releaseLock4();
    });

    it('creates the lock directory when acquiring a group lock', async () => {
      const lockDir = getLockDir();
      expect(existsSync(lockDir)).toBe(false);

      const releaseLock = await LockManager.acquireGroupLock('test-group');

      expect(existsSync(lockDir)).toBe(true);
      expect(existsSync(join(lockDir, 'test-group.lock'))).toBe(true);

      await releaseLock();
    });
  });

  describe('withLock', () => {
    it('runs the handler under the global lock', async () => {
      let executed = false;

      const result = await LockManager.withLock('global', null, () => {
        executed = true;
        return Promise.resolve('test-result');
      });

      expect(executed).toBe(true);
      expect(result).toBe('test-result');
    });

    it('runs the handler under a group lock', async () => {
      let executed = false;

      const result = await LockManager.withLock('group', 'test-group', () => {
        executed = true;
        return Promise.resolve('test-result');
      });

      expect(executed).toBe(true);
      expect(result).toBe('test-result');
    });

    it('throws when a group lock is requested without a group name', async () => {
      await expect(
        LockManager.withLock('group', null, () => {
          return Promise.resolve('test-result');
        })
      ).rejects.toThrow('Group name is required to acquire a group lock');
    });

    it('releases the lock even when the handler throws', async () => {
      // ロックを取得してからエラーを投げる
      await expect(
        LockManager.withLock('global', null, () => {
          return Promise.reject(new Error('test error'));
        })
      ).rejects.toThrow('test error');

      // ロックが解放されたことを確認（再度ロックを取得できる）
      const releaseLock = await LockManager.acquireGlobalLock();
      await releaseLock();
    });

    it('acquires multiple locks sequentially', async () => {
      const releaseLock1 = await LockManager.acquireGlobalLock();
      await releaseLock1();

      const releaseLock2 = await LockManager.acquireGlobalLock();
      await releaseLock2();

      const releaseLock3 = await LockManager.acquireGroupLock('group-1');
      await releaseLock3();

      const releaseLock4 = await LockManager.acquireGroupLock('group-2');
      await releaseLock4();
    });
  });

  describe('LockTimeoutError', () => {
    it('constructs LockTimeoutError properly', () => {
      const lockPath = '/path/to/lock';
      const error = new LockTimeoutError(lockPath);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('LockTimeoutError');
      expect(error.message).toContain(lockPath);
      expect(error.message).toContain('timed out');
    });

    it('throws LockTimeoutError when acquireGlobalLock times out', async () => {
      vi.mocked(lock).mockRejectedValue(new Error('Lock timeout'));

      await expect(LockManager.acquireGlobalLock()).rejects.toThrow(LockTimeoutError);
    });

    it('throws LockTimeoutError when acquireGroupLock times out', async () => {
      vi.mocked(lock).mockRejectedValue(new Error('Lock timeout'));

      await expect(LockManager.acquireGroupLock('test-group')).rejects.toThrow(LockTimeoutError);
    });
  });

  describe('LockReleaseError', () => {
    it('throws LockReleaseError when releasing fails', async () => {
      const releaseError = new Error('Release failed');
      vi.mocked(lock).mockResolvedValue(() => {
        return Promise.reject(releaseError);
      });

      const releaseLock = await LockManager.acquireGlobalLock();

      await expect(releaseLock()).rejects.toThrow(LockReleaseError);
    });

    it('constructs LockReleaseError properly when given an Error cause', () => {
      const lockPath = '/path/to/lock';
      const cause = new Error('release failed');
      const error = new LockReleaseError(lockPath, cause);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('LockReleaseError');
      expect(error.message).toContain(lockPath);
      expect(error.message).toContain('release failed');
    });

    it('constructs LockReleaseError properly when given a string cause', () => {
      const lockPath = '/path/to/lock';
      const cause = 'release failed';
      const error = new LockReleaseError(lockPath, cause);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('LockReleaseError');
      expect(error.message).toContain(lockPath);
      expect(error.message).toContain('release failed');
    });
  });
});
