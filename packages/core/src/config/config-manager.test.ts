import { ConfigManager, PortResolutionError } from './config-manager.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs';

import type { GlobalConfig, PortMuxConfig } from './schema.js';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const baseConfig: PortMuxConfig = {
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
  it('resolveCommandEnv prefers commandEnv when resolving environment variables', () => {
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

  it('resolveEnvObject resolves references within env recursively', () => {
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

  it('resolveCommandPorts resolves numeric and env-based ports', () => {
    const previous = process.env.PORT;
    process.env.PORT = '4000';

    try {
      const result = ConfigManager.resolveCommandPorts(
        [3000, '${PORT}', '5000'],
        { PORT: '3001' },
        {
          commandName: 'web',
        }
      );

      expect(result).toEqual([3000, 3001, 5000]);
    } finally {
      if (previous === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previous;
      }
    }
  });

  it('resolveCommandPorts throws when a port env var is missing', () => {
    const previous = process.env.MISSING_PORT;
    delete process.env.MISSING_PORT;

    try {
      expect(() => ConfigManager.resolveCommandPorts(['${MISSING_PORT}'], {})).toThrow(PortResolutionError);
      expect(() => ConfigManager.resolveCommandPorts(['${MISSING_PORT}'], {})).toThrow(/MISSING_PORT/);
    } finally {
      if (previous !== undefined) {
        process.env.MISSING_PORT = previous;
      }
    }
  });

  it('resolveCommandPorts throws when a resolved port is not numeric', () => {
    const previous = process.env.BAD_PORT;
    process.env.BAD_PORT = 'not-a-number';

    try {
      expect(() => ConfigManager.resolveCommandPorts(['${BAD_PORT}'], {})).toThrow(PortResolutionError);
      expect(() => ConfigManager.resolveCommandPorts(['${BAD_PORT}'], {})).toThrow(/not a positive integer/);
    } finally {
      if (previous === undefined) {
        delete process.env.BAD_PORT;
      } else {
        process.env.BAD_PORT = previous;
      }
    }
  });

  it('findConfigFile walks up parent directories to locate the config file', () => {
    const { root, nestedDir, configPath } = createTempProject();
    try {
      const found = ConfigManager.findConfigFile(nestedDir);
      expect(found).toBe(configPath);
    } finally {
      cleanupTempDir(root);
    }
  });

  it('loadConfig reads the file and returns the validated config', () => {
    const { root, configPath } = createTempProject();
    try {
      const loaded = ConfigManager.loadConfig(configPath);
      expect(loaded).toEqual(baseConfig);
    } finally {
      cleanupTempDir(root);
    }
  });

  describe('mergeGlobalAndProjectConfigs', () => {
    it('merges and returns the global and project configs', () => {
      const { root: root1 } = createTempProject();
      const anotherGroup = baseConfig.groups.default;
      if (!anotherGroup) {
        throw new Error('baseConfig must have default group');
      }
      const { root: root2 } = createTempProject({
        ...baseConfig,
        groups: {
          another: anotherGroup,
        },
      });

      const globalConfig: GlobalConfig = {
        repositories: {
          'group-1': { path: root1, group: 'default' },
          'group-2': { path: root2, group: 'another' },
        },
      };

      const globalConfigPath = join(tmpdir(), 'portmux-configs', `${Math.random().toString(36)}.json`);
      writeGlobalConfig(globalConfigPath, globalConfig);
      vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);

      try {
        const merged = ConfigManager.mergeGlobalAndProjectConfigs();

        expect(merged).not.toBeNull();
        expect(Object.keys(merged?.repositories ?? {})).toEqual(['group-1', 'group-2']);
        expect(merged?.repositories['group-1']?.projectConfigPath).toBe(join(root1, 'portmux.config.json'));
        expect(merged?.repositories['group-1']?.groupDefinitionName).toBe('default');
        expect(merged?.repositories['group-2']?.groupDefinitionName).toBe('another');
      } finally {
        cleanupTempDir(root1);
        cleanupTempDir(root2);
        rmSync(dirname(globalConfigPath), { recursive: true, force: true });
      }
    });

    it('ignores other invalid entries when targetRepository is provided', () => {
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        repositories: {
          valid: { path: root, group: 'default' },
          invalid: { path: '/does-not-exist', group: 'default' },
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

    it('skips invalid repositories when skipInvalid is true', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { root } = createTempProject();
      const globalConfig: GlobalConfig = {
        repositories: {
          valid: { path: root, group: 'default' },
          invalid: { path: '/does-not-exist', group: 'default' },
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

    it('expands tilde-prefixed paths in the global config', () => {
      const fakeHome = mkdtempSync(join(tmpdir(), 'portmux-home-'));
      const originalHome = process.env.HOME;
      process.env.HOME = fakeHome;
      const projectRoot = mkdtempSync(join(fakeHome, 'portmux-tilde-'));
      const projectConfigPath = join(projectRoot, 'portmux.config.json');
      writeFileSync(projectConfigPath, JSON.stringify(baseConfig, null, 2), 'utf-8');

      const globalConfig: GlobalConfig = {
        repositories: {
          tilde: { path: projectRoot.replace(fakeHome, '~'), group: 'default' },
        },
      };

      const globalConfigPath = join(tmpdir(), 'portmux-configs', `${Math.random().toString(36)}.json`);
      writeGlobalConfig(globalConfigPath, globalConfig);
      vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);

      try {
        const merged = ConfigManager.mergeGlobalAndProjectConfigs();

        expect(merged).not.toBeNull();
        expect(merged?.repositories.tilde?.path).toBe(realpathSync(projectRoot));
      } finally {
        cleanupTempDir(projectRoot);
        rmSync(dirname(globalConfigPath), { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });
  });
});
