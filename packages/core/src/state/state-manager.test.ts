import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir as systemTmpdir } from 'node:os';
import { StateManager, type ProcessState } from './state-manager.js';

const testHomeDir = mkdtempSync(join(systemTmpdir(), 'portmux-state-home-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testHomeDir,
  };
});

const portmuxDir = join(testHomeDir, '.config', 'portmux');
const stateDir = join(portmuxDir, 'state');

describe('StateManager', () => {
  beforeEach(() => {
    rmSync(portmuxDir, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(testHomeDir, { recursive: true, force: true });
  });

  it('writeState と readState で状態を永続化できる', () => {
    const state: ProcessState = {
      workspace: 'App',
      process: 'API Server',
      status: 'Running',
      pid: 4321,
      startedAt: new Date().toISOString(),
    };

    StateManager.writeState(state.workspace, state.process, state);
    const loaded = StateManager.readState(state.workspace, state.process);

    expect(loaded).toEqual(state);
  });

  it('deleteState で状態ファイルを削除できる', () => {
    const state = { workspace: 'App', process: 'Worker', status: 'Stopped' } as const;

    StateManager.writeState(state.workspace, state.process, state);
    StateManager.deleteState(state.workspace, state.process);

    expect(StateManager.readState(state.workspace, state.process)).toBeNull();
  });

  it('listAllStates は全ての状態を返し、破損ファイルをスキップする', () => {
    const first = { workspace: 'ws-1', process: 'api', status: 'Running' } as const;
    const second = { workspace: 'ws-2', process: 'worker', status: 'Stopped' } as const;

    StateManager.writeState(first.workspace, first.process, first);
    StateManager.writeState(second.workspace, second.process, second);

    writeFileSync(join(stateDir, 'corrupted.json'), '{ invalid json', 'utf-8');

    const states = StateManager.listAllStates();

    expect(states).toHaveLength(2);
    expect(states).toEqual(expect.arrayContaining([first, second]));
  });

  it('generateLogPath はログディレクトリを作成し、スラッグ化されたファイル名を返す', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42);

    const logPath = StateManager.generateLogPath('My Workspace', 'Service/API');

    expect(logPath.startsWith(join(portmuxDir, 'logs'))).toBe(true);
    expect(logPath).toContain('My-Workspace-Service-API-');
    expect(existsSync(join(portmuxDir, 'logs'))).toBe(true);

    nowSpy.mockRestore();
  });
});
