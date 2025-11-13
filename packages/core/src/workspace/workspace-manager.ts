import { ConfigManager } from '../config/config-manager.js';
import type { PortMuxConfig } from '../config/schema.js';
import { existsSync, realpathSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { execSync } from 'child_process';

/**
 * ワークスペース解決エラー
 */
export class WorkspaceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceResolutionError';
  }
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
interface GitWorktreeInfo {
  path: string;
  head: string;
  branch: string;
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
  } catch {
    return [];
  }
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
 * ワークスペースを管理するオブジェクト
 */
export const WorkspaceManager = {
  /**
   * ワークスペース名から設定を解決
   *
   * @param workspaceName ワークスペース名
   * @returns 解決されたワークスペース情報
   * @throws WorkspaceResolutionError ワークスペースが見つからない場合
   */
  resolveWorkspaceByName(workspaceName: string): ResolvedWorkspace {
    // グローバル設定を読み込み
    const globalConfig = ConfigManager.loadGlobalConfig();
    if (!globalConfig) {
      throw new WorkspaceResolutionError(
        `ワークスペース "${workspaceName}" が見つかりません。\n` +
          `グローバル設定ファイル (${ConfigManager.getGlobalConfigPath()}) が存在しません。`
      );
    }

    // ワークスペースを検索
    const workspace = globalConfig.workspaces[workspaceName];
    if (!workspace) {
      throw new WorkspaceResolutionError(`ワークスペース "${workspaceName}" がグローバル設定に見つかりません。`);
    }

    // プロジェクト設定を読み込み
    const projectConfigPath = join(workspace.path, 'portmux.config.json');
    if (!existsSync(projectConfigPath)) {
      throw new WorkspaceResolutionError(
        `ワークスペース "${workspaceName}" のプロジェクト設定ファイルが見つかりません: ${projectConfigPath}`
      );
    }

    const projectConfig = ConfigManager.loadConfig(projectConfigPath);

    // ワークスペース定義の存在確認
    if (!projectConfig.workspaces[workspace.workspace]) {
      throw new WorkspaceResolutionError(
        `プロジェクト設定内にワークスペース定義 "${workspace.workspace}" が見つかりません。\n` +
          `プロジェクト設定: ${projectConfigPath}`
      );
    }

    return {
      name: workspaceName,
      path: normalizePath(workspace.path),
      projectConfig,
      projectConfigPath,
      workspaceDefinitionName: workspace.workspace,
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
        `プロジェクト設定ファイル (portmux.config.json) が見つかりません。\n` +
          `カレントディレクトリ: ${normalizedCwd}`
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
      // カレントディレクトリとマッチするワークスペースを探す
      for (const [workspaceName, workspace] of Object.entries(globalConfig.workspaces)) {
        const workspacePath = normalizePath(workspace.path);
        if (workspacePath === normalizedCwd || workspacePath === projectRoot) {
          return {
            name: workspaceName,
            path: workspacePath,
            projectConfig,
            projectConfigPath,
            workspaceDefinitionName: workspace.workspace,
          };
        }
      }

      // 見つからない場合は最初のワークスペースを使用
      const firstWorkspaceName = Object.keys(projectConfig.workspaces)[0];
      if (!firstWorkspaceName) {
        throw new WorkspaceResolutionError('プロジェクト設定にワークスペースが定義されていません。');
      }

      console.warn(
        `警告: グローバル設定でワークスペースが見つかりません。` +
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

    // グローバル設定でマッチするワークスペースを探す
    for (const [workspaceName, workspace] of Object.entries(globalConfig.workspaces)) {
      const workspacePath = normalizePath(workspace.path);
      if (workspacePath === matchedWorktreePath) {
        return {
          name: workspaceName,
          path: workspacePath,
          projectConfig,
          projectConfigPath,
          workspaceDefinitionName: workspace.workspace,
        };
      }
    }

    throw new WorkspaceResolutionError(
      `git worktree に対応するワークスペースがグローバル設定に見つかりません。\n` +
        `worktree パス: ${matchedWorktreePath}\n` +
        `グローバル設定ファイルにワークスペースを追加してください: ${ConfigManager.getGlobalConfigPath()}`
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

    for (const workspaceName of Object.keys(globalConfig.workspaces)) {
      try {
        const resolved = this.resolveWorkspaceByName(workspaceName);
        workspaces.push(resolved);
      } catch {
        // エラーが発生した場合はスキップ
        continue;
      }
    }

    return workspaces;
  },
};

