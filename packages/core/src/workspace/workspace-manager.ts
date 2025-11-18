import { ConfigManager } from '../config/config-manager.js';
import type { PortMuxConfig } from '../config/schema.js';
import { existsSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { execSync } from 'child_process';
import { StateManager } from '../state/state-manager.js';
import { PortmuxError } from '../errors.js';

/**
 * ワークスペース解決エラー
 */
export class WorkspaceResolutionError extends PortmuxError {
  override readonly name = 'WorkspaceResolutionError';
}

/**
 * ワークスペース情報
 */
export interface ResolvedWorkspace {
  name: string;
  path: string;
  projectConfig: PortMuxConfig;
  projectConfigPath: string;
  workspaceDefinitionName: string;
}

/**
 * Git worktree 情報
 */
export interface GitWorktreeInfo {
  path: string;
  head: string;
  branch: string;
}

export interface WorkspaceSelection {
  repositoryName: string;
  projectName: string;
  path: string;
  workspaceDefinitionName: string;
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
 * 実行中ワークスペースの集合を返す
 */
function getRunningWorkspaceNames(): Set<string> {
  const states = StateManager.listAllStates();
  const running = states.filter((state) => state.status === 'Running').map((state) => state.workspace);
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
 * ワークスペースを管理するオブジェクト
 */
export const WorkspaceManager = {
  /**
   * Resolve a workspace from a repository entry name in the global config.
   *
   * @param repositoryName Repository name defined in the global config
   * @returns Resolved workspace information
   * @throws WorkspaceResolutionError When the workspace cannot be resolved
   */
  resolveWorkspaceByName(repositoryName: string): ResolvedWorkspace {
    // グローバル設定を読み込み
    const globalConfig = ConfigManager.loadGlobalConfig();
    if (!globalConfig) {
      throw new WorkspaceResolutionError(
        `リポジトリ "${repositoryName}" が見つかりません。\n` +
          `グローバル設定ファイル (${ConfigManager.getGlobalConfigPath()}) が存在しません。`
      );
    }

    // リポジトリを検索
    const repository = globalConfig.repositories[repositoryName];
    if (!repository) {
      throw new WorkspaceResolutionError(`リポジトリ "${repositoryName}" がグローバル設定に見つかりません。`);
    }

    // プロジェクト設定を読み込み
    const projectConfigPath = join(repository.path, 'portmux.config.json');
    if (!existsSync(projectConfigPath)) {
      throw new WorkspaceResolutionError(
        `リポジトリ "${repositoryName}" のプロジェクト設定ファイルが見つかりません: ${projectConfigPath}`
      );
    }

    const projectConfig = ConfigManager.loadConfig(projectConfigPath);

    // ワークスペース定義の存在確認
    if (!projectConfig.workspaces[repository.workspace]) {
      throw new WorkspaceResolutionError(
        `プロジェクト設定内にワークスペース定義 "${repository.workspace}" が見つかりません。\n` +
          `プロジェクト設定: ${projectConfigPath}`
      );
    }

    return {
      name: repositoryName,
      path: normalizePath(repository.path),
      projectConfig,
      projectConfigPath,
      workspaceDefinitionName: repository.workspace,
    };
  },

  /**
   * カレントディレクトリから自動的にワークスペースを解決
   *
   * @param startDir 開始ディレクトリ（デフォルト: process.cwd()）
   * @returns 解決されたワークスペース情報
   * @throws WorkspaceResolutionError ワークスペースが見つからない場合
   */
  resolveWorkspaceAuto(startDir: string = process.cwd()): ResolvedWorkspace {
    const normalizedCwd = normalizePath(startDir);

    // プロジェクト設定ファイルを探す
    let projectConfigPath: string;
    try {
      projectConfigPath = ConfigManager.findConfigFile(startDir);
    } catch {
      throw new WorkspaceResolutionError(
        `プロジェクト設定ファイル (portmux.config.json) が見つかりません。\n` + `カレントディレクトリ: ${normalizedCwd}`
      );
    }

    const projectConfig = ConfigManager.loadConfig(projectConfigPath);
    const projectRoot = normalizePath(dirname(projectConfigPath));

    // グローバル設定を読み込み
    const globalConfig = ConfigManager.loadGlobalConfig();
    if (!globalConfig) {
      // グローバル設定がない場合はフォールバックモード
      // プロジェクト設定の最初のワークスペースを使用
      const firstWorkspaceName = Object.keys(projectConfig.workspaces)[0];
      if (!firstWorkspaceName) {
        throw new WorkspaceResolutionError('プロジェクト設定にワークスペースが定義されていません。');
      }

      return {
        name: firstWorkspaceName,
        path: projectRoot,
        projectConfig,
        projectConfigPath,
        workspaceDefinitionName: firstWorkspaceName,
      };
    }

    // Git リポジトリのルートを探す
    const gitRoot = findGitRoot(startDir);
    if (!gitRoot) {
      // Git 環境ではない場合はフォールバックモード
      // カレントディレクトリとマッチするリポジトリを探す
      for (const [repositoryName, repository] of Object.entries(globalConfig.repositories)) {
        const workspacePath = normalizePath(repository.path);
        if (workspacePath === normalizedCwd || workspacePath === projectRoot) {
          return {
            name: repositoryName,
            path: workspacePath,
            projectConfig,
            projectConfigPath,
            workspaceDefinitionName: repository.workspace,
          };
        }
      }

      // 見つからない場合は最初のワークスペースを使用
      const firstWorkspaceName = Object.keys(projectConfig.workspaces)[0];
      if (!firstWorkspaceName) {
        throw new WorkspaceResolutionError('プロジェクト設定にワークスペースが定義されていません。');
      }

      console.warn(
        `警告: グローバル設定でリポジトリが見つかりません。` +
          `デフォルトのワークスペース "${firstWorkspaceName}" を使用します。`
      );

      return {
        name: firstWorkspaceName,
        path: projectRoot,
        projectConfig,
        projectConfigPath,
        workspaceDefinitionName: firstWorkspaceName,
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
      throw new WorkspaceResolutionError(
        `カレントディレクトリに対応する git worktree が見つかりません。\n` + `カレントディレクトリ: ${normalizedCwd}`
      );
    }

    const matchedWorktreePath = normalizePath(matchedWorktree.path);

    // グローバル設定でマッチするリポジトリを探す
    for (const [repositoryName, repository] of Object.entries(globalConfig.repositories)) {
      const workspacePath = normalizePath(repository.path);
      if (workspacePath === matchedWorktreePath) {
        return {
          name: repositoryName,
          path: workspacePath,
          projectConfig,
          projectConfigPath,
          workspaceDefinitionName: repository.workspace,
        };
      }
    }

    throw new WorkspaceResolutionError(
      `git worktree に対応するリポジトリがグローバル設定に見つかりません。\n` +
        `worktree パス: ${matchedWorktreePath}\n` +
        `グローバル設定ファイルにリポジトリを追加してください: ${ConfigManager.getGlobalConfigPath()}`
    );
  },

  /**
   * すべてのワークスペースを列挙
   *
   * @returns すべてのワークスペース情報の配列
   */
  listAllWorkspaces(): ResolvedWorkspace[] {
    const globalConfig = ConfigManager.loadGlobalConfig();
    if (!globalConfig) {
      return [];
    }

    const workspaces: ResolvedWorkspace[] = [];

    for (const repositoryName of Object.keys(globalConfig.repositories)) {
      try {
        const resolved = this.resolveWorkspaceByName(repositoryName);
        workspaces.push(resolved);
      } catch {
        // エラーが発生した場合はスキップ
        continue;
      }
    }

    return workspaces;
  },

  /**
   * 対話選択用のワークスペース一覧を生成
   *
   * @param worktrees git worktree list の結果
   * @param options includeAll が true の場合は worktree に含まれないワークスペースも表示
   * @returns 選択肢に利用できるワークスペース情報
   */
  buildSelectableWorkspaces(
    worktrees: GitWorktreeInfo[],
    options?: {
      includeAll?: boolean;
    }
  ): WorkspaceSelection[] {
    const globalConfig = ConfigManager.loadGlobalConfig();
    if (!globalConfig) {
      return [];
    }

    const includeAll = options?.includeAll ?? false;
    const normalizedWorktreePaths = new Set(worktrees.map((worktree) => normalizePath(worktree.path)));
    const runningWorkspaces = getRunningWorkspaceNames();
    const selections: WorkspaceSelection[] = [];

    for (const [repositoryName, repository] of Object.entries(globalConfig.repositories)) {
      const normalizedPath = normalizePath(repository.path);

      if (!includeAll && normalizedWorktreePaths.size > 0 && !normalizedWorktreePaths.has(normalizedPath)) {
        continue;
      }

      selections.push({
        repositoryName,
        projectName: getProjectName(normalizedPath),
        path: normalizedPath,
        workspaceDefinitionName: repository.workspace,
        isRunning: runningWorkspaces.has(repositoryName),
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
