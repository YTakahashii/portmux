import { ConfigManager, VersionMismatchError } from './config-manager.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';

import type { GlobalConfig, PortMuxConfig } from './schema.js';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const baseConfig: PortMuxConfig = {
  version: '1.0.0',
  runner: { mode: 'background' },
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
  },
};

function createTempProject(config: PortMuxConfig = baseConfig): {
  root: string;
  configPath: string;
  nestedDir: string;
} {
  const tempRoot = mkdtempSync(join(tmpdir(), 'portmux-config-'));
  const configPath = join(tempRoot, 'portmux.config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  const nestedDir = join(tempRoot, 'packages', 'app');
  mkdirSync(nestedDir, { recursive: true });

  return { root: tempRoot, configPath, nestedDir };
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function writeGlobalConfig(path: string, config: GlobalConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfigManager', () => {
  it('resolveCommandEnv は commandEnv を優先して環境変数を解決する', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previous = process.env.TEST_GLOBAL_VAR;
    process.env.TEST_GLOBAL_VAR = 'global-value';

    const result = ConfigManager.resolveCommandEnv('echo ${LOCAL} ${TEST_GLOBAL_VAR} ${UNKNOWN}', {
      LOCAL: 'local-value',
      TEST_GLOBAL_VAR: 'command-value',
    });

    expect(result).toBe('echo local-value command-value ');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN'));

    if (previous === undefined) {
      delete process.env.TEST_GLOBAL_VAR;
    } else {
      process.env.TEST_GLOBAL_VAR = previous;
    }
  });

  it('resolveEnvObject は env 内の参照を再帰的に解決する', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = {
      API_BASE: 'https://example.com',
      SERVICE_URL: '${API_BASE}/service',
      TOKEN: '${MISSING}',
    };

    const resolved = ConfigManager.resolveEnvObject(env);

    expect(resolved).toEqual({
      API_BASE: 'https://example.com',
      SERVICE_URL: 'https://example.com/service',
      TOKEN: '',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MISSING'));
  });

  it('validateVersion はメジャーバージョンが異なる場合にエラーを投げる', () => {
    expect(() => {
      ConfigManager.validateVersion('2.0.0');
    }).toThrow(VersionMismatchError);
  });

  it('validateVersion はサポートより新しいマイナーバージョンで警告を出す', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ConfigManager.validateVersion('1.2.0');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1.2.0'));
  });

  it('findConfigFile は親ディレクトリを遡って設定ファイルを検出する', () => {
    const { root, nestedDir, configPath } = createTempProject();
    try {
      const found = ConfigManager.findConfigFile(nestedDir);
      expect(found).toBe(configPath);
    } finally {
      cleanupTempDir(root);
    }
  });

  it('loadConfig はファイルを読み込みバリデーション済みの設定を返す', () => {
    const { root, configPath } = createTempProject();
    try {
      const loaded = ConfigManager.loadConfig(configPath);
      expect(loaded).toEqual(baseConfig);
    } finally {
      cleanupTempDir(root);
    }
  });

  it('loadConfig はメジャーバージョンが異なる設定でエラーを投げる', () => {
    const invalidConfig: PortMuxConfig = {
      ...baseConfig,
      version: '2.0.0',
    };
    const { root, configPath } = createTempProject(invalidConfig);
    try {
      expect(() => {
        ConfigManager.loadConfig(configPath);
      }).toThrow(VersionMismatchError);
    } finally {
      cleanupTempDir(root);
    }
  });

  describe('mergeGlobalAndProjectConfigs', () => {
    it('グローバル設定とプロジェクト設定をマージして返す', () => {
      const { root: root1 } = createTempProject();
      const anotherWorkspace = baseConfig.workspaces.default;
      if (!anotherWorkspace) {
        throw new Error('baseConfig must have default workspace');
      }
      const { root: root2 } = createTempProject({
        ...baseConfig,
        workspaces: {
          another: anotherWorkspace,
        },
      });

      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          'workspace-1': { path: root1, workspace: 'default' },
          'workspace-2': { path: root2, workspace: 'another' },
        },
      };

      const globalConfigPath = join(tmpdir(), 'portmux-configs', `${Math.random().toString(36)}.json`);
      writeGlobalConfig(globalConfigPath, globalConfig);
      vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);

      try {
        const merged = ConfigManager.mergeGlobalAndProjectConfigs();

        expect(merged).not.toBeNull();
        expect(Object.keys(merged?.repositories ?? {})).toEqual(['workspace-1', 'workspace-2']);
        expect(merged?.repositories['workspace-1']?.projectConfigPath).toBe(join(root1, 'portmux.config.json'));
        expect(merged?.repositories['workspace-1']?.workspaceDefinitionName).toBe('default');
        expect(merged?.repositories['workspace-2']?.workspaceDefinitionName).toBe('another');
      } finally {
        cleanupTempDir(root1);
        cleanupTempDir(root2);
        rmSync(dirname(globalConfigPath), { recursive: true, force: true });
      }
    });

    it('targetRepository 指定時に他の無効なエントリを無視できる', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          valid: { path: root, workspace: 'default' },
          invalid: { path: '/does-not-exist', workspace: 'default' },
        },
      };

      const globalConfigPath = join(tmpdir(), 'portmux-configs', `${Math.random().toString(36)}.json`);
      writeGlobalConfig(globalConfigPath, globalConfig);
      vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);

      try {
        const merged = ConfigManager.mergeGlobalAndProjectConfigs({ targetRepository: 'valid' });

        expect(merged).not.toBeNull();
        expect(Object.keys(merged?.repositories ?? {})).toEqual(['valid']);
      } finally {
        cleanupTempDir(root);
        rmSync(dirname(globalConfigPath), { recursive: true, force: true });
      }
    });

    it('skipInvalid が true の場合は無効なリポジトリをスキップする', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        version: '1.0.0',
        repositories: {
          valid: { path: root, workspace: 'default' },
          invalid: { path: '/does-not-exist', workspace: 'default' },
        },
      };

      const globalConfigPath = join(tmpdir(), 'portmux-configs', `${Math.random().toString(36)}.json`);
      writeGlobalConfig(globalConfigPath, globalConfig);
      vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);

      try {
        const merged = ConfigManager.mergeGlobalAndProjectConfigs({ skipInvalid: true });

        expect(merged).not.toBeNull();
        expect(Object.keys(merged?.repositories ?? {})).toEqual(['valid']);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        cleanupTempDir(root);
        rmSync(dirname(globalConfigPath), { recursive: true, force: true });
      }
    });
  });
});
