import { ConfigManager } from '../config/config-manager.js';
import type { PortMuxConfig } from '../config/schema.js';
import { existsSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { execSync } from 'child_process';
import { StateManager } from '../state/state-manager.js';
import { PortmuxError } from '../errors.js';

/**
 * グループ解決エラー
 */
export class GroupResolutionError extends PortmuxError {
  override readonly name = 'GroupResolutionError';
}

/**
 * グループ情報
 */
export interface ResolvedGroup {
  name: string;
  path: string;
  projectConfig: PortMuxConfig;
  projectConfigPath: string;
  groupDefinitionName: string;
}

/**
 * Git worktree 情報
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
 * .git ファイルまたはディレクトリを探して Git リポジトリのルートを特定
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
 * git worktree list の実行と解析
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
 * git worktree list --porcelain の出力をパース
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
 * パスを正規化（シンボリックリンクを解決）
 */
function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * 実行中グループの集合を返す
 */
function getRunningGroupNames(): Set<string> {
  const states = StateManager.listAllStates();
  const running = states.filter((state) => state.status === 'Running').map((state) => state.group);
  return new Set(running);
}

/**
 * プロジェクト名をパスから導出
 */
function getProjectName(path: string): string {
  const name = basename(path);
  return name || path;
}

/**
 * グループを管理するオブジェクト
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
   * カレントディレクトリから自動的にグループを解決
   *
   * @param startDir 開始ディレクトリ（デフォルト: process.cwd()）
   * @returns 解決されたグループ情報
   * @throws GroupResolutionError グループが見つからない場合
   */
  resolveGroupAuto(startDir: string = process.cwd()): ResolvedGroup {
    const normalizedCwd = normalizePath(startDir);

    // プロジェクト設定ファイルを探す
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

    // グローバル設定を読み込み
    const mergedConfig = ConfigManager.mergeGlobalAndProjectConfigs({ skipInvalid: true });
    if (!mergedConfig) {
      // グローバル設定がない場合はフォールバックモード
      // プロジェクト設定の最初のグループを使用
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

    // Git リポジトリのルートを探す
    const gitRoot = findGitRoot(startDir);
    if (!gitRoot) {
      // Git 環境ではない場合はフォールバックモード
      // カレントディレクトリとマッチするリポジトリを探す
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

      // 見つからない場合は最初のグループを使用
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

    // git worktree list を実行
    const worktrees = getGitWorktrees(gitRoot);

    // カレントディレクトリとマッチする worktree を探す
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

    // グローバル設定でマッチするリポジトリを探す
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
   * すべてのグループを列挙
   *
   * @returns すべてのグループ情報の配列
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
   * 対話選択用のグループ一覧を生成
   *
   * @param worktrees git worktree list の結果
   * @param options includeAll が true の場合は worktree に含まれないグループも表示
   * @returns 選択肢に利用できるグループ情報
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
