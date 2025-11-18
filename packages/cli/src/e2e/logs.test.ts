import { ConfigManager, StateManager } from '@portmux/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStartCommand } from '../commands/start.js';
import { runLogsCommand } from '../commands/logs.js';

describe('logs command integration', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'portmux-e2e-logs-'));
    const homeDir = join(tempDir, 'home');
    mkdirSync(homeDir, { recursive: true });
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.chdir(tempDir);

    globalConfigPath = join(homeDir, '.config', 'portmux', 'config.json');
    mkdirSync(join(homeDir, '.config', 'portmux'), { recursive: true });
    const projectConfigPath = join(tempDir, 'portmux.config.json');

    const workspaceName = 'app';
    const commandName = 'svc';
    const command = 'node -e "console.log(\'hello from logs test\'); setInterval(() => {}, 2000)"';

    const projectConfig = {
      version: '1.0.0',
      runner: { mode: 'background' as const },
      workspaces: {
        [workspaceName]: {
          description: '',
          commands: [{ name: commandName, command }],
        },
      },
    };
    writeFileSync(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`);

    const globalConfig = {
      version: '1.0.0',
      repositories: {
        [workspaceName]: { path: tempDir, workspace: workspaceName },
      },
    };
    writeFileSync(globalConfigPath, `${JSON.stringify(globalConfig, null, 2)}\n`);

    vi.spyOn(ConfigManager, 'getGlobalConfigPath').mockReturnValue(globalConfigPath);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    try {
      const states = StateManager.listAllStates();
      for (const state of states) {
        if (state.pid !== undefined) {
          try {
            process.kill(state.pid);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore cleanup failure
    }
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints log output for a running process without following', async () => {
    await runStartCommand('app');

    // 書き込みとログ生成の反映を待つ
    await new Promise((resolve) => setTimeout(resolve, 500));

    runLogsCommand('app', 'svc', { lines: '10', follow: false, timestamps: false });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('hello from logs test'));
    expect(process.exit).not.toHaveBeenCalled();
  });
});
