import { ConfigManager, VersionMismatchError } from './config-manager.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';

import type { PortMuxConfig } from './schema.js';
import { join } from 'path';
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
});
