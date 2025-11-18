import type { GlobalConfig, PortMuxConfig } from '../config/schema.js';
import { WorkspaceManager, WorkspaceResolutionError } from './workspace-manager.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';

import { join } from 'path';
import { tmpdir as systemTmpdir } from 'node:os';

const testHomeDir = mkdtempSync(join(systemTmpdir(), 'portmux-workspace-home-'));

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
  workspaces: {
    default: {
      description: 'Default workspace',
      commands: [
        {
          name: 'api',
          command: 'pnpm dev',
          ports: [3000],
        },
      ],
    },
    dev: {
      description: 'Dev workspace',
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
    'workspace-1': {
      path: '/tmp/workspace-1',
      workspace: 'default',
    },
    'workspace-2': {
      path: '/tmp/workspace-2',
      workspace: 'dev',
    },
  },
};

function createTempProject(config: PortMuxConfig = baseProjectConfig): {
  root: string;
  configPath: string;
} {
  const tempRoot = mkdtempSync(join(systemTmpdir(), 'portmux-workspace-'));
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

describe('WorkspaceManager', () => {
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

  describe('resolveWorkspaceByName', () => {
    it('ワークスペース名から設定を解決できる', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: root,
            workspace: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      const resolved = WorkspaceManager.resolveWorkspaceByName('test-workspace');

      expect(resolved.name).toBe('test-workspace');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.workspaceDefinitionName).toBe('default');
      expect(resolved.projectConfig).toEqual(baseProjectConfig);

      cleanupTempDir(root);
    });

    it('グローバル設定ファイルが存在しない場合にエラーを投げる', () => {
      expect(() => {
        WorkspaceManager.resolveWorkspaceByName('test-workspace');
      }).toThrow(WorkspaceResolutionError);
    });

    it('ワークスペースがグローバル設定に見つからない場合にエラーを投げる', () => {
      createGlobalConfig();

      expect(() => {
        WorkspaceManager.resolveWorkspaceByName('non-existent');
      }).toThrow(WorkspaceResolutionError);
    });

    it('プロジェクト設定ファイルが見つからない場合にエラーを投げる', () => {
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: '/non-existent-path',
            workspace: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      expect(() => {
        WorkspaceManager.resolveWorkspaceByName('test-workspace');
      }).toThrow(WorkspaceResolutionError);
    });

    it('プロジェクト設定内にワークスペース定義が見つからない場合にエラーを投げる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: root,
            workspace: 'non-existent',
          },
        },
      };
      createGlobalConfig(globalConfig);

      expect(() => {
        WorkspaceManager.resolveWorkspaceByName('test-workspace');
      }).toThrow(WorkspaceResolutionError);

      cleanupTempDir(root);
    });
  });

  describe('resolveWorkspaceAuto', () => {
    it('Git worktree からワークスペースを解決できる', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: root,
            workspace: 'default',
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

      const resolved = WorkspaceManager.resolveWorkspaceAuto(root);

      expect(resolved.name).toBe('test-workspace');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.workspaceDefinitionName).toBe('default');

      cleanupTempDir(root);
    });

    it('グローバル設定がない場合はフォールバックモードで最初のワークスペースを使用', () => {
      const { root, configPath } = createTempProject();

      const resolved = WorkspaceManager.resolveWorkspaceAuto(root);

      expect(resolved.name).toBe('default');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.workspaceDefinitionName).toBe('default');

      cleanupTempDir(root);
    });

    it('プロジェクト設定ファイルが見つからない場合にエラーを投げる', () => {
      const tempRoot = mkdtempSync(join(systemTmpdir(), 'portmux-workspace-'));

      expect(() => {
        WorkspaceManager.resolveWorkspaceAuto(tempRoot);
      }).toThrow(WorkspaceResolutionError);

      cleanupTempDir(tempRoot);
    });

    it('Git 環境ではない場合はパスマッチでワークスペースを解決', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: root,
            workspace: 'default',
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

      const resolved = WorkspaceManager.resolveWorkspaceAuto(root);

      expect(resolved.name).toBe('test-workspace');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.workspaceDefinitionName).toBe('default');

      cleanupTempDir(root);
    });

    it('Git 環境ではない場合、マッチしない場合は最初のワークスペースを使用して警告を出す', () => {
      const { root, configPath } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: '/different-path',
            workspace: 'default',
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

      const resolved = WorkspaceManager.resolveWorkspaceAuto(root);

      expect(resolved.name).toBe('default');
      expect(resolved.path).toBe(realpathSync(root));
      expect(resolved.projectConfigPath).toBe(configPath);
      expect(resolved.workspaceDefinitionName).toBe('default');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('警告'));

      warnSpy.mockRestore();
      cleanupTempDir(root);
    });

    it('git worktree が見つからない場合にエラーを投げる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: root,
            workspace: 'default',
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
        WorkspaceManager.resolveWorkspaceAuto(root);
      }).toThrow(WorkspaceResolutionError);

      cleanupTempDir(root);
    });

    it('git worktree に対応するワークスペースがグローバル設定に見つからない場合にエラーを投げる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'test-workspace': {
            path: '/different-path',
            workspace: 'default',
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
        WorkspaceManager.resolveWorkspaceAuto(root);
      }).toThrow(WorkspaceResolutionError);

      cleanupTempDir(root);
    });
  });

  describe('listAllWorkspaces', () => {
    it('すべてのワークスペースを列挙できる', () => {
      const { root: root1 } = createTempProject();
      const devWorkspace = baseProjectConfig.workspaces.dev;
      if (!devWorkspace) {
        throw new Error('dev workspace is not defined');
      }
      const { root: root2 } = createTempProject({
        ...baseProjectConfig,
        workspaces: {
          dev: devWorkspace,
        },
      });

      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'workspace-1': {
            path: root1,
            workspace: 'default',
          },
          'workspace-2': {
            path: root2,
            workspace: 'dev',
          },
        },
      };
      createGlobalConfig(globalConfig);

      const workspaces = WorkspaceManager.listAllWorkspaces();

      expect(workspaces).toHaveLength(2);
      expect(workspaces.map((w) => w.name)).toEqual(expect.arrayContaining(['workspace-1', 'workspace-2']));

      cleanupTempDir(root1);
      cleanupTempDir(root2);
    });

    it('グローバル設定が存在しない場合は空配列を返す', () => {
      const workspaces = WorkspaceManager.listAllWorkspaces();
      expect(workspaces).toEqual([]);
    });

    it('エラーが発生したワークスペースはスキップされる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'valid-workspace': {
            path: root,
            workspace: 'default',
          },
          'invalid-workspace': {
            path: '/non-existent-path',
            workspace: 'default',
          },
        },
      };
      createGlobalConfig(globalConfig);

      const workspaces = WorkspaceManager.listAllWorkspaces();

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]?.name).toBe('valid-workspace');

      cleanupTempDir(root);
    });
  });
});
