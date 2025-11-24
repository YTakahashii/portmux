import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runSyncCommand } from './sync.js';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('runSyncCommand', () => {
  let homeDir: string;
  let projectDir: string;
  let originalCwd: string;
  let originalHome: string | undefined;

  const globalConfigPath = (): string => join(homeDir, '.config', 'portmux', 'config.json');

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'portmux-sync-'));
    projectDir = join(homeDir, 'repo');
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    process.chdir(projectDir);
    process.env.HOME = homeDir;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
    rmSync(homeDir, { recursive: true, force: true });
  });

  function writeProjectConfig(
    groups: Record<string, { description?: string; commands?: Record<string, string>[] }>
  ): void {
    writeFileSync(
      join(projectDir, 'portmux.config.json'),
      JSON.stringify(
        {
          groups,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  it('registers a single group when no global config exists', () => {
    writeProjectConfig({
      app: { description: 'desc', commands: [{ name: 'dev', command: 'echo dev' }] },
    });

    runSyncCommand();

    const normalizedProjectDir = realpathSync(projectDir);
    const content = JSON.parse(readFileSync(globalConfigPath(), 'utf-8'));
    expect(content).toEqual({
      repositories: {
        app: { path: normalizedProjectDir, group: 'app' },
      },
    });
  });

  it('requires selection when multiple groups exist without flags', () => {
    writeProjectConfig({
      api: { description: '', commands: [{ name: 'api', command: 'echo api' }] },
      worker: { description: '', commands: [{ name: 'worker', command: 'echo worker' }] },
    });

    runSyncCommand();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Multiple groups found. Use --group <name> or --all to select targets.')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(existsSync(globalConfigPath())).toBe(false);
  });

  it('registers all groups with default aliases when --all is provided', () => {
    writeProjectConfig({
      api: { description: '', commands: [{ name: 'api', command: 'echo api' }] },
      worker: { description: '', commands: [{ name: 'worker', command: 'echo worker' }] },
    });

    runSyncCommand({ all: true });

    const normalizedProjectDir = realpathSync(projectDir);
    const content = JSON.parse(readFileSync(globalConfigPath(), 'utf-8'));
    expect(content.repositories).toEqual({
      'repo:api': { path: normalizedProjectDir, group: 'api' },
      'repo:worker': { path: normalizedProjectDir, group: 'worker' },
    });
  });

  it('does not write changes in dry-run mode', () => {
    writeProjectConfig({
      app: { description: '', commands: [{ name: 'dev', command: 'echo dev' }] },
    });

    runSyncCommand({ dryRun: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run: no changes were written.'));
    expect(existsSync(globalConfigPath())).toBe(false);
  });

  it('prunes stale entries before writing', () => {
    writeProjectConfig({
      app: { description: '', commands: [{ name: 'dev', command: 'echo dev' }] },
    });

    const stalePath = join(homeDir, 'missing');
    mkdirSync(join(homeDir, '.config', 'portmux'), { recursive: true });
    writeFileSync(
      globalConfigPath(),
      JSON.stringify(
        {
          repositories: {
            stale: { path: stalePath, group: 'old' },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    runSyncCommand({ prune: true });

    const normalizedProjectDir = realpathSync(projectDir);
    const content = JSON.parse(readFileSync(globalConfigPath(), 'utf-8'));
    expect(content.repositories).toEqual({
      app: { path: normalizedProjectDir, group: 'app' },
    });
  });
});
