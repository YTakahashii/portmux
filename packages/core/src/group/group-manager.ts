import { ConfigManager } from '../config/config-manager.js';
import type { PortMuxConfig } from '../config/schema.js';
import { existsSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { execSync } from 'child_process';
import { StateManager } from '../state/state-manager.js';
import { PortmuxError } from '../errors.js';

/**
 * Error thrown when a group cannot be resolved
 */
export class GroupResolutionError extends PortmuxError {
  override readonly name = 'GroupResolutionError';
}

/**
 * Resolved group information
 */
export interface ResolvedGroup {
  name: string;
  path: string;
  projectConfig: PortMuxConfig;
  projectConfigPath: string;
  groupDefinitionName: string;
}

/**
 * Data returned for each git worktree
 */
export interface GitWorktreeInfo {
  path: string;
  head: string;
  branch: string;
}

export interface GroupSelection {
  repositoryName: string;
  projectName: string;
  path: string;
  groupDefinitionName: string;
  isRunning: boolean;
}

/**
 * Locate the git repository root by finding a .git directory or file
 */
function findGitRoot(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const root = resolve('/');

  while (currentDir !== root) {
    const gitPath = join(currentDir, '.git');
    if (existsSync(gitPath)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Run and parse `git worktree list`
 */
function getGitWorktrees(gitRoot: string): GitWorktreeInfo[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: gitRoot,
      encoding: 'utf-8',
    });

    return parseGitWorktreeList(output);
  } catch {
    return [];
  }
}

/**
 * Parse the output of `git worktree list --porcelain`
 */
export function parseGitWorktreeList(output: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  const lines = output.split('\n');
  let currentWorktree: Partial<GitWorktreeInfo> = {};

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentWorktree.path = line.substring('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      currentWorktree.head = line.substring('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      currentWorktree.branch = line.substring('branch '.length);
    } else if (line === '') {
      if (currentWorktree.path) {
        worktrees.push({
          path: currentWorktree.path,
          head: currentWorktree.head ?? '',
          branch: currentWorktree.branch ?? '',
        });
      }
      currentWorktree = {};
    }
  }

  return worktrees;
}

/**
 * Normalize a path (resolve symbolic links)
 */
function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Return the set of currently running groups
 */
function getRunningGroupNames(): Set<string> {
  const states = StateManager.listAllStates();
  const running = states.filter((state) => state.status === 'Running').map((state) => state.group);
  return new Set(running);
}

/**
 * Derive the project name from a path
 */
function getProjectName(path: string): string {
  const name = basename(path);
  return name || path;
}

/**
 * Group manager
 */
export const GroupManager = {
  /**
   * Resolve a group from a repository entry name in the global config.
   *
   * @param repositoryName Repository name defined in the global config
   * @returns Resolved group information
   * @throws GroupResolutionError When the group cannot be resolved
   */
  resolveGroupByName(repositoryName: string): ResolvedGroup {
    let merged = null;
    try {
      merged = ConfigManager.mergeGlobalAndProjectConfigs({ targetRepository: repositoryName });
    } catch (error) {
      throw new GroupResolutionError(error instanceof Error ? error.message : String(error));
    }
    if (!merged) {
      throw new GroupResolutionError(
        `Repository "${repositoryName}" was not found.\n` +
          `The global config file (${ConfigManager.getGlobalConfigPath()}) does not exist.`
      );
    }

    const mergedRepository = merged.repositories[repositoryName];
    if (!mergedRepository) {
      throw new GroupResolutionError(`Repository "${repositoryName}" was not found in the global config.`);
    }

    return {
      name: repositoryName,
      path: mergedRepository.path,
      projectConfig: mergedRepository.projectConfig,
      projectConfigPath: mergedRepository.projectConfigPath,
      groupDefinitionName: mergedRepository.groupDefinitionName,
    };
  },

  /**
   * Resolve a group automatically starting from the current directory.
   *
   * @param startDir Directory to start from (default: process.cwd())
   * @returns Resolved group information
   * @throws GroupResolutionError When the group cannot be found
   */
  resolveGroupAuto(startDir: string = process.cwd()): ResolvedGroup {
    const normalizedCwd = normalizePath(startDir);

    // Locate the project config file
    let projectConfigPath: string;
    try {
      projectConfigPath = ConfigManager.findConfigFile(startDir);
    } catch {
      throw new GroupResolutionError(
        `Project config file (portmux.config.json) was not found.\n` + `Current directory: ${normalizedCwd}`
      );
    }

    const projectConfig = ConfigManager.loadConfig(projectConfigPath);
    const projectRoot = normalizePath(dirname(projectConfigPath));

    // Load the global configuration
    const mergedConfig = ConfigManager.mergeGlobalAndProjectConfigs({ skipInvalid: true });
    if (!mergedConfig) {
      // Fall back to the first group when no global config exists
      const firstGroupName = Object.keys(projectConfig.groups)[0];
      if (!firstGroupName) {
        throw new GroupResolutionError('No groups are defined in the project config.');
      }

      return {
        name: firstGroupName,
        path: projectRoot,
        projectConfig,
        projectConfigPath,
        groupDefinitionName: firstGroupName,
      };
    }

    // Determine the git repository root
    const gitRoot = findGitRoot(startDir);
    if (!gitRoot) {
      // In non-git environments, try to match the current directory
      for (const mergedRepository of Object.values(mergedConfig.repositories)) {
        const groupPath = mergedRepository.path;
        if (groupPath === normalizedCwd || groupPath === projectRoot) {
          return {
            name: mergedRepository.name,
            path: groupPath,
            projectConfig: mergedRepository.projectConfig,
            projectConfigPath: mergedRepository.projectConfigPath,
            groupDefinitionName: mergedRepository.groupDefinitionName,
          };
        }
      }

      // Default to the first group when we cannot find a match
      const firstGroupName = Object.keys(projectConfig.groups)[0];
      if (!firstGroupName) {
        throw new GroupResolutionError('No groups are defined in the project config.');
      }

      console.warn(`Warning: No repository match found in the global config. Using default group "${firstGroupName}".`);

      return {
        name: firstGroupName,
        path: projectRoot,
        projectConfig,
        projectConfigPath,
        groupDefinitionName: firstGroupName,
      };
    }

    // Invoke `git worktree list`
    const worktrees = getGitWorktrees(gitRoot);

    // Find the worktree that matches the current directory
    let matchedWorktree: GitWorktreeInfo | null = null;
    for (const worktree of worktrees) {
      const worktreePath = normalizePath(worktree.path);
      if (normalizedCwd.startsWith(worktreePath)) {
        matchedWorktree = worktree;
        break;
      }
    }

    if (!matchedWorktree) {
      throw new GroupResolutionError(
        `No git worktree matches the current directory.\n` + `Current directory: ${normalizedCwd}`
      );
    }

    const matchedWorktreePath = normalizePath(matchedWorktree.path);

    // Locate the matching repository in the global config
    for (const mergedRepository of Object.values(mergedConfig.repositories)) {
      const groupPath = mergedRepository.path;
      if (groupPath === matchedWorktreePath) {
        return {
          name: mergedRepository.name,
          path: groupPath,
          projectConfig: mergedRepository.projectConfig,
          projectConfigPath: mergedRepository.projectConfigPath,
          groupDefinitionName: mergedRepository.groupDefinitionName,
        };
      }
    }

    throw new GroupResolutionError(
      `The repository for this git worktree is not defined in the global config.\n` +
        `Worktree path: ${matchedWorktreePath}\n` +
        `Add the repository to the global config file: ${ConfigManager.getGlobalConfigPath()}`
    );
  },

  /**
   * Enumerate every group
   *
   * @returns Array of resolved group info
   */
  listAllGroups(): ResolvedGroup[] {
    const mergedConfig = ConfigManager.mergeGlobalAndProjectConfigs({ skipInvalid: true });
    if (!mergedConfig) {
      return [];
    }

    const groups: ResolvedGroup[] = [];

    for (const mergedRepository of Object.values(mergedConfig.repositories)) {
      groups.push({
        name: mergedRepository.name,
        path: mergedRepository.path,
        projectConfig: mergedRepository.projectConfig,
        projectConfigPath: mergedRepository.projectConfigPath,
        groupDefinitionName: mergedRepository.groupDefinitionName,
      });
    }

    return groups;
  },

  /**
   * Build a list of groups suitable for interactive selection
   *
   * @param worktrees Result of git worktree list
   * @param options When includeAll is true, show groups not present in any worktree
   * @returns Selectable group information
   */
  buildSelectableGroups(
    worktrees: GitWorktreeInfo[],
    options?: {
      includeAll?: boolean;
    }
  ): GroupSelection[] {
    const mergedConfig = ConfigManager.mergeGlobalAndProjectConfigs({ skipInvalid: true });
    if (!mergedConfig) {
      return [];
    }

    const includeAll = options?.includeAll ?? false;
    const normalizedWorktreePaths = new Set(worktrees.map((worktree) => normalizePath(worktree.path)));
    const runningGroups = getRunningGroupNames();
    const selections: GroupSelection[] = [];

    for (const mergedRepository of Object.values(mergedConfig.repositories)) {
      const normalizedPath = mergedRepository.path;

      if (!includeAll && normalizedWorktreePaths.size > 0 && !normalizedWorktreePaths.has(normalizedPath)) {
        continue;
      }

      selections.push({
        repositoryName: mergedRepository.name,
        projectName: getProjectName(normalizedPath),
        path: normalizedPath,
        groupDefinitionName: mergedRepository.groupDefinitionName,
        isRunning: runningGroups.has(mergedRepository.name),
      });
    }

    selections.sort((a, b) => {
      const projectCompare = a.projectName.localeCompare(b.projectName);
      if (projectCompare !== 0) {
        return projectCompare;
      }
      return a.repositoryName.localeCompare(b.repositoryName);
    });

    return selections;
  },
};
