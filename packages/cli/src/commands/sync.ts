import { ConfigManager, ConfigNotFoundError, ConfigValidationError, type GlobalConfig } from '@portmux/core';
import { Command } from 'commander';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import { homedir } from 'os';
import { chalk } from '../lib/chalk.js';

interface SyncOptions {
  group?: string;
  all?: boolean;
  name?: string;
  force?: boolean;
  dryRun?: boolean;
  prune?: boolean;
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function buildDefaultAlias(groupName: string, projectRoot: string, isMultiGroup: boolean): string {
  if (!isMultiGroup) {
    return groupName;
  }
  const projectName = basename(projectRoot) || 'portmux';
  return `${projectName}:${groupName}`;
}

function selectTargetGroups(
  projectConfigGroups: string[],
  projectRoot: string,
  options: SyncOptions
): { alias: string; group: string }[] {
  const isMultiGroup = projectConfigGroups.length > 1;

  if (options.name && options.all) {
    throw new Error('The --name option cannot be used together with --all.');
  }

  if (options.all) {
    return projectConfigGroups.map((group) => ({
      alias: buildDefaultAlias(group, projectRoot, true),
      group,
    }));
  }

  const targetGroup = options.group ?? (projectConfigGroups.length === 1 ? projectConfigGroups[0] : null);
  if (!targetGroup) {
    throw new Error('Multiple groups found. Use --group <name> or --all to select targets.');
  }

  return [
    {
      alias: options.name ?? buildDefaultAlias(targetGroup, projectRoot, isMultiGroup),
      group: targetGroup,
    },
  ];
}

function pruneGlobalConfig(globalConfig: GlobalConfig): string[] {
  const removed: string[] = [];
  const keptEntries = Object.entries(globalConfig.repositories).filter(([alias, repository]) => {
    const repositoryRoot = normalizeRepositoryPath(repository.path);
    const configPath = join(repositoryRoot, 'portmux.config.json');
    const shouldKeep = existsSync(repositoryRoot) && existsSync(configPath);
    if (!shouldKeep) {
      removed.push(alias);
    }
    return shouldKeep;
  });

  globalConfig.repositories = Object.fromEntries(keptEntries);
  return removed;
}

function getHomeDirectory(): string {
  const home = process.env.HOME ?? homedir();
  try {
    return realpathSync(home);
  } catch {
    return resolve(home);
  }
}

function expandHome(path: string): string {
  const home = getHomeDirectory();
  if (path === '~') {
    return home;
  }

  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(home, path.slice(2));
  }

  return path;
}

function normalizeRepositoryPath(path: string): string {
  const expanded = expandHome(path);
  try {
    return realpathSync(expanded);
  } catch {
    return resolve(expanded);
  }
}

function shortenHome(path: string): string {
  const home = getHomeDirectory();
  const normalizedPath = normalizeRepositoryPath(path);
  if (normalizedPath === home) {
    return '~';
  }

  const homeWithSep = home.endsWith(sep) ? home : `${home}${sep}`;
  if (normalizedPath.startsWith(homeWithSep)) {
    return `~${normalizedPath.slice(home.length)}`;
  }

  return normalizedPath;
}

export function runSyncCommand(options: SyncOptions = {}): void {
  try {
    const projectConfigPath = ConfigManager.findConfigFile();
    const projectConfig = ConfigManager.loadConfig(projectConfigPath);
    const projectRoot = resolve(dirname(projectConfigPath));
    const normalizedProjectRoot = normalizeRepositoryPath(projectRoot);
    const storedProjectRoot = shortenHome(normalizedProjectRoot);

    const groupNames = Object.keys(projectConfig.groups);
    if (groupNames.length === 0) {
      console.error(chalk.red('Error: No groups are defined in portmux.config.json.'));
      process.exit(1);
      return;
    }

    let targets: { alias: string; group: string }[];
    try {
      targets = selectTargetGroups(groupNames, projectRoot, options);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
      return;
    }

    const globalConfigPath = ConfigManager.getGlobalConfigPath();
    const globalConfig: GlobalConfig = ConfigManager.loadGlobalConfig() ?? { repositories: {} };

    let pruned: string[] = [];
    if (options.prune) {
      pruned = pruneGlobalConfig(globalConfig);
    }

    const updates: string[] = [];
    const skipped: string[] = [];

    for (const target of targets) {
      const existing = globalConfig.repositories[target.alias];
      if (existing) {
        const existingPath = normalizeRepositoryPath(existing.path);
        if (existingPath === normalizedProjectRoot && existing.group === target.group) {
          skipped.push(`Unchanged: ${target.alias} (${target.group})`);
          continue;
        }

        if (!options.force) {
          skipped.push(
            `Skipped existing entry "${target.alias}". Use --force to overwrite or choose a different --name.`
          );
          continue;
        }
      }

      globalConfig.repositories[target.alias] = {
        path: storedProjectRoot,
        group: target.group,
      };

      updates.push(`${existing ? 'Updated' : 'Added'}: ${target.alias} (${target.group}) -> ${storedProjectRoot}`);
    }

    ConfigManager.validateGlobalConfig(globalConfig, projectConfig, projectConfigPath);

    if (options.dryRun) {
      console.log(chalk.yellow('Dry run: no changes were written.'));
      if (pruned.length > 0) {
        console.log(chalk.yellow(`Would prune: ${pruned.join(', ')}`));
      }
      if (updates.length > 0) {
        console.log(chalk.green(`Would apply: ${updates.join('; ')}`));
      }
      if (skipped.length > 0) {
        console.log(chalk.yellow(skipped.join('; ')));
      }
      return;
    }

    writeJsonFile(globalConfigPath, globalConfig);

    if (pruned.length > 0) {
      console.log(chalk.yellow(`Pruned entries: ${pruned.join(', ')}`));
    }
    for (const line of updates) {
      console.log(chalk.green(`✓ ${line}`));
    }
    for (const line of skipped) {
      console.log(chalk.yellow(line));
    }

    if (updates.length === 0 && pruned.length === 0) {
      console.log(chalk.yellow('No changes were made.'));
    }
  } catch (error) {
    if (error instanceof ConfigNotFoundError || error instanceof ConfigValidationError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
      return;
    }

    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function createSyncCommand(): Command {
  return new Command('sync')
    .description('Register the current project in the global config')
    .option('--group <name>', 'Group to register (defaults to the first when only one exists)')
    .option('--all', 'Register all groups defined in the project config')
    .option('--name <alias>', 'Repository alias to use in the global config (single group only)')
    .option('--force', 'Overwrite existing entries with the same alias')
    .option('--dry-run', 'Show what would change without writing the global config')
    .option('--prune', 'Remove global entries whose paths or configs no longer exist')
    .action((options: SyncOptions) => {
      runSyncCommand(options);
    });
}

export const syncCommand: ReturnType<typeof createSyncCommand> = createSyncCommand();
