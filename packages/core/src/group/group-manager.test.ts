import type { GlobalConfig, PortMuxConfig } from '../config/schema.js';
import { GroupManager, GroupResolutionError } from './group-manager.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';

import { join } from 'path';
import { tmpdir as systemTmpdir } from 'node:os';

const testHomeDir = mkdtempSync(join(systemTmpdir(), 'portmux-group-home-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testHomeDir,
  };
});

// child_process と fs のモック用変数（vi.mock の外で定義）
// vi.mock はホイスティングされるため、vi.hoisted で初期化
const mockStore: {
  execSync: ReturnType<typeof vi.fn>;
  existsSync: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  execSync: vi.fn(),
  existsSync: vi.fn(),
}));

const actualExistsSyncStore: {
  existsSync: undefined | typeof import('fs').existsSync;
} = vi.hoisted(() => ({
  existsSync: undefined,
}));

const getActualExistsSync = (): typeof import('fs').existsSync => {
  if (typeof actualExistsSyncStore.existsSync !== 'function') {
    throw new Error('actual existsSync is not initialized');
  }
  return actualExistsSyncStore.existsSync;
};

const callActualExistsSync = (path: string): ReturnType<typeof import('fs').existsSync> => getActualExistsSync()(path);

vi.mock('child_process', () => ({
  execSync: mockStore.execSync,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  actualExistsSyncStore.existsSync = actual.existsSync;
  return {
    ...actual,
    existsSync: mockStore.existsSync,
  };
});

const globalConfigPath = join(testHomeDir, '.config', 'portmux', 'config.json');

const baseProjectConfig: PortMuxConfig = {
  version: '1.0.0',
  groups: {
    default: {
      description: 'Default group',
      commands: [
        {
          name: 'api',
          command: 'pnpm dev',
          ports: [3000],
        },
      ],
    },
    dev: {
      description: 'Dev group',
      commands: [
        {
          name: 'api',
          command: 'pnpm dev',
          ports: [3001],
        },
      ],
    },
  },
};

const baseGlobalConfig: GlobalConfig = {
  version: '1.0.0',
  repositories: {
    'group-1': {
      path: '/tmp/group-1',
      group: 'default',
    },
    'group-2': {
      path: '/tmp/group-2',
      group: 'dev',
    },
  },
};

function createTempProject(config: PortMuxConfig = baseProjectConfig): {
  root: string;
  configPath: string;
} {
  const tempRoot = mkdtempSync(join(systemTmpdir(), 'portmux-group-'));
  const configPath = join(tempRoot, 'portmux.config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return { root: tempRoot, configPath };
}

function createGlobalConfig(config: GlobalConfig = baseGlobalConfig): void {
  const configDir = join(testHomeDir, '.config', 'portmux');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(globalConfigPath, JSON.stringify(config, null, 2), 'utf-8');
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('GroupManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockStore.execSync.mockClear();
    mockStore.existsSync.mockClear();
    // デフォルトでは実際の existsSync を使う
    mockStore.existsSync.mockImplementation(callActualExistsSync);
    rmSync(join(testHomeDir, '.config'), { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
  });

  describe('resolveGroupByName', () => {
    it('グループ名から設定を解決できる', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: root,
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      const resolved = GroupManager.resolveGroupByName('test-group');

      expect(resolved.name).toBe('test-group');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.groupDefinitionName).toBe('default');
      expect(resolved.projectConfig).toEqual(baseProjectConfig);

      cleanupTempDir(root);
    });

    it('グローバル設定ファイルが存在しない場合にエラーを投げる', () => {
      expect(() => {
        GroupManager.resolveGroupByName('test-group');
      }).toThrow(GroupResolutionError);
    });

    it('グループがグローバル設定に見つからない場合にエラーを投げる', () => {
      createGlobalConfig();

      expect(() => {
        GroupManager.resolveGroupByName('non-existent');
      }).toThrow(GroupResolutionError);
    });

    it('プロジェクト設定ファイルが見つからない場合にエラーを投げる', () => {
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: '/non-existent-path',
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      expect(() => {
        GroupManager.resolveGroupByName('test-group');
      }).toThrow(GroupResolutionError);
    });

    it('プロジェクト設定内にグループ定義が見つからない場合にエラーを投げる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: root,
            group: 'non-existent',
          },
        },
      };
      createGlobalConfig(globalConfig);

      expect(() => {
        GroupManager.resolveGroupByName('test-group');
      }).toThrow(GroupResolutionError);

      cleanupTempDir(root);
    });
  });

  describe('resolveGroupAuto', () => {
    it('Git worktree からグループを解決できる', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: root,
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      // execSync をモック（encoding: 'utf-8' の場合は文字列を返す）
      mockStore.execSync.mockImplementation((_command: string, options?: { encoding?: string }) => {
        if (options?.encoding === 'utf-8') {
          return `worktree ${root}\nHEAD abc123\nbranch refs/heads/main\n\n`;
        }
        return Buffer.from(`worktree ${root}\nHEAD abc123\nbranch refs/heads/main\n\n`);
      });

      // findGitRoot が root を返すようにモック
      mockStore.existsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.git')) {
          return path === join(root, '.git');
        }
        return callActualExistsSync(path);
      });

      const resolved = GroupManager.resolveGroupAuto(root);

      expect(resolved.name).toBe('test-group');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.groupDefinitionName).toBe('default');

      cleanupTempDir(root);
    });

    it('グローバル設定がない場合はフォールバックモードで最初のグループを使用', () => {
      const { root, configPath } = createTempProject();

      const resolved = GroupManager.resolveGroupAuto(root);

      expect(resolved.name).toBe('default');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.groupDefinitionName).toBe('default');

      cleanupTempDir(root);
    });

    it('プロジェクト設定ファイルが見つからない場合にエラーを投げる', () => {
      const tempRoot = mkdtempSync(join(systemTmpdir(), 'portmux-group-'));

      expect(() => {
        GroupManager.resolveGroupAuto(tempRoot);
      }).toThrow(GroupResolutionError);

      cleanupTempDir(tempRoot);
    });

    it('Git 環境ではない場合はパスマッチでグループを解決', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: root,
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      // findGitRoot が null を返すようにモック
      mockStore.existsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.git')) {
          return false;
        }
        return callActualExistsSync(path);
      });

      const resolved = GroupManager.resolveGroupAuto(root);

      expect(resolved.name).toBe('test-group');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.groupDefinitionName).toBe('default');

      cleanupTempDir(root);
    });

    it('Git 環境ではない場合、マッチしない場合は最初のグループを使用して警告を出す', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: '/different-path',
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      // findGitRoot が null を返すようにモック
      mockStore.existsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.git')) {
          return false;
        }
        return callActualExistsSync(path);
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const resolved = GroupManager.resolveGroupAuto(root);

      expect(resolved.name).toBe('default');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.groupDefinitionName).toBe('default');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));

      warnSpy.mockRestore();
      cleanupTempDir(root);
    });

    it('git worktree が見つからない場合にエラーを投げる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: root,
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      // findGitRoot が root を返すようにモック
      mockStore.existsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.git')) {
          return path === join(root, '.git');
        }
        return callActualExistsSync(path);
      });

      // execSync が空の結果を返すようにモック
      mockStore.execSync.mockImplementation((_command: string, options?: { encoding?: string }) => {
        if (options?.encoding === 'utf-8') {
          return '';
        }
        return Buffer.from('');
      });

      expect(() => {
        GroupManager.resolveGroupAuto(root);
      }).toThrow(GroupResolutionError);

      cleanupTempDir(root);
    });

    it('git worktree に対応するグループがグローバル設定に見つからない場合にエラーを投げる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-group': {
            path: '/different-path',
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      // findGitRoot が root を返すようにモック
      mockStore.existsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.git')) {
          return path === join(root, '.git');
        }
        return callActualExistsSync(path);
      });

      // execSync をモック（encoding: 'utf-8' の場合は文字列を返す）
      mockStore.execSync.mockImplementation((_command: string, options?: { encoding?: string }) => {
        if (options?.encoding === 'utf-8') {
          return `worktree ${root}\nHEAD abc123\nbranch refs/heads/main\n\n`;
        }
        return Buffer.from(`worktree ${root}\nHEAD abc123\nbranch refs/heads/main\n\n`);
      });

      expect(() => {
        GroupManager.resolveGroupAuto(root);
      }).toThrow(GroupResolutionError);

      cleanupTempDir(root);
    });
  });

  describe('listAllGroups', () => {
    it('すべてのグループを列挙できる', () => {
      const { root: root1 } = createTempProject();
      const devGroup = baseProjectConfig.groups.dev;
      if (!devGroup) {
        throw new Error('dev group is not defined');
      }
      const { root: root2 } = createTempProject({
        ...baseProjectConfig,
        groups: {
          dev: devGroup,
        },
      });

      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'group-1': {
            path: root1,
            group: 'default',
          },
          'group-2': {
            path: root2,
            group: 'dev',
          },
        },
      };
      createGlobalConfig(globalConfig);

      const groups = GroupManager.listAllGroups();

      expect(groups).toHaveLength(2);
      expect(groups.map((w) => w.name)).toEqual(expect.arrayContaining(['group-1', 'group-2']));

      cleanupTempDir(root1);
      cleanupTempDir(root2);
    });

    it('グローバル設定が存在しない場合は空配列を返す', () => {
      const groups = GroupManager.listAllGroups();
      expect(groups).toEqual([]);
    });

    it('エラーが発生したグループはスキップされる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'valid-group': {
            path: root,
            group: 'default',
          },
          'invalid-group': {
            path: '/non-existent-path',
            group: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      const groups = GroupManager.listAllGroups();

      expect(groups).toHaveLength(1);
      expect(groups[0]?.name).toBe('valid-group');

      cleanupTempDir(root);
    });
  });
});
