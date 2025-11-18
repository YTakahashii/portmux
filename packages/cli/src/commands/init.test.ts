import { ConfigManager } from '@portmux/core';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import inquirer from 'inquirer';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInitCommand } from './init.js';

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('true\n'),
}));

function mockPromptSequence(responses: Record<string, unknown>[]) {
  let index = 0;
  const promptSpy = vi.spyOn(inquirer, 'prompt').mockImplementation(() => {
    const response = responses[index];
    if (!response) {
      throw new Error(`Unexpected prompt call at index ${String(index)}`);
    }
    index += 1;
    return Promise.resolve(response as never);
  });

  return promptSpy;
}

describe('runInitCommand', () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'portmux-cli-')));
    process.chdir(tempDir);

    globalConfigPath = join(tempDir, '.config', 'portmux', 'config.json');
    vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit: ${String(code ?? 0)}`);
    }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates project and global configs from prompts', async () => {
    mockPromptSequence([
      { groupName: 'app', description: 'demo group' },
      { name: 'api', command: 'npm start', ports: '3000', cwd: './services/api' },
      { addEnv: true },
      { key: 'API_URL', value: 'http://localhost:3000' },
      { addEnv: false },
      { addMore: false },
    ]);

    await runInitCommand({});

    const projectConfig = JSON.parse(readFileSync(join(tempDir, 'portmux.config.json'), 'utf-8'));
    expect(projectConfig).toEqual({
      $schema: 'node_modules/@portmux/cli/schemas/portmux.config.schema.json',
      version: '1.0.0',
      groups: {
        app: {
          description: 'demo group',
          commands: [
            {
              name: 'api',
              command: 'npm start',
              ports: [3000],
              cwd: './services/api',
              env: { API_URL: 'http://localhost:3000' },
            },
          ],
        },
      },
    });

    const globalConfig = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    expect(globalConfig).toEqual({
      version: '1.0.0',
      repositories: {
        app: {
          path: tempDir,
          group: 'app',
        },
      },
    });
  });

  it('skips global update when repository exists without force', async () => {
    mkdirSync(dirname(globalConfigPath), { recursive: true });
    const existingGlobal = {
      version: '1.0.0',
      repositories: {
        app: { path: '/existing/path', group: 'default' },
      },
    };
    writeFileSync(globalConfigPath, `${JSON.stringify(existingGlobal, null, 2)}\n`);

    mockPromptSequence([
      { groupName: 'app', description: '' },
      { name: 'service', command: 'node index.js', ports: '', cwd: '' },
      { addEnv: false },
      { addMore: false },
    ]);

    await runInitCommand({});

    const projectConfig = JSON.parse(readFileSync(join(tempDir, 'portmux.config.json'), 'utf-8'));
    expect(projectConfig.groups.app.commands[0]).toMatchObject({
      name: 'service',
      command: 'node index.js',
    });

    const globalConfig = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    expect(globalConfig).toEqual(existingGlobal);
  });

  it('overwrites global repository when force is enabled', async () => {
    mkdirSync(dirname(globalConfigPath), { recursive: true });
    const existingGlobal = {
      version: '1.0.0',
      repositories: {
        app: { path: '/old', group: 'legacy' },
      },
    };
    writeFileSync(globalConfigPath, `${JSON.stringify(existingGlobal, null, 2)}\n`);

    mockPromptSequence([
      { groupName: 'app', description: 'updated' },
      { name: 'web', command: 'npm run dev', ports: '4000,4001', cwd: '' },
      { addEnv: false },
      { addMore: false },
    ]);

    await runInitCommand({ force: true });

    const globalConfig = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    expect(globalConfig.repositories.app).toEqual({
      path: tempDir,
      group: 'app',
    });
  });

  it('aborts when project config overwrite is denied', async () => {
    const projectConfigPath = join(tempDir, 'portmux.config.json');
    writeFileSync(projectConfigPath, '{"existing":true}');

    mockPromptSequence([{ overwrite: false }]);

    await runInitCommand({});

    const projectConfig = readFileSync(projectConfigPath, 'utf-8');
    expect(projectConfig).toBe('{"existing":true}');
    expect(() => readFileSync(globalConfigPath, 'utf-8')).toThrow();
  });
});
