import { ConfigManager, StateManager } from '@portmux/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { runRestartCommand } from '../commands/restart.js';
import { psCommand } from '../commands/ps.js';
import { runStartCommand } from '../commands/start.js';
import { runStopCommand } from '../commands/stop.js';

describe('basic CLI workflow (init → start → ps → restart → stop)', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'portmux-e2e-'));
    const homeDir = join(tempDir, 'home');
    mkdirSync(homeDir, { recursive: true });
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.chdir(tempDir);

    globalConfigPath = join(homeDir, '.config', 'portmux', 'config.json');
    mkdirSync(join(homeDir, '.config', 'portmux'), { recursive: true });
    const projectConfigPath = join(tempDir, 'portmux.config.json');

    const groupName = 'app';
    const commandName = 'svc';
    const command = 'node -e "setInterval(() => {}, 2000)"';

    const projectConfig = {
      groups: {
        [groupName]: {
          description: '',
          commands: [{ name: commandName, command }],
        },
      },
    };
    writeFileSync(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`);

    const globalConfig = {
      repositories: {
        [groupName]: { path: tempDir, group: groupName },
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

  async function runStart(): Promise<void> {
    await runStartCommand('app');
  }

  async function runPs(): Promise<void> {
    await psCommand.parseAsync(['node', 'ps'], { from: 'user' });
  }

  async function runRestart(): Promise<void> {
    await runRestartCommand('app');
  }

  async function runStop(): Promise<void> {
    await runStopCommand('app');
  }

  it('runs start → ps → restart → stop against real processes', async () => {
    await runStart();

    const afterStart = StateManager.listAllStates();
    const errorCalls = (console.error as unknown as Mock).mock.calls;
    if (errorCalls.length > 0) {
      throw new Error(`start errors: ${JSON.stringify(errorCalls.flat())}`);
    }
    expect(afterStart).toHaveLength(1);
    expect(afterStart[0]?.pid).toBeDefined();

    await runPs();
    expect(console.log).toHaveBeenCalled();

    await runRestart();
    const afterRestart = StateManager.listAllStates();
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0]?.pid).toBeDefined();

    await runStop();
    const afterStop = StateManager.listAllStates();
    expect(afterStop).toHaveLength(0);
  });
});
