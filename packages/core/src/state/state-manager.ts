import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';

import { homedir } from 'os';
import { join } from 'path';

/**
 * プロセスの状態
 */
export type ProcessStatus = 'Running' | 'Stopped' | 'Error';

/**
 * プロセス状態のデータ構造
 */
export interface ProcessState {
  workspace: string;
  process: string;
  status: ProcessStatus;
  pid?: number;
  error?: string;
  startedAt?: string; // ISO 8601形式の日時文字列
  stoppedAt?: string; // ISO 8601形式の日時文字列
}

/**
 * 状態ファイルのベースディレクトリ
 */
const STATE_DIR = join(homedir(), '.config', 'portmux', 'state');

/**
 * 文字列をスラッグ化（ファイル名として安全な形式に変換）
 * 特殊文字をハイフンに置換し、連続するハイフンを1つにまとめる
 */
function slugify(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 状態ファイルのパスを取得
 */
function getStateFilePath(workspace: string, process: string): string {
  const workspaceSlug = slugify(workspace);
  const processSlug = slugify(process);
  const filename = `${workspaceSlug}-${processSlug}.json`;
  return join(STATE_DIR, filename);
}

/**
 * 状態ディレクトリを確保（存在しない場合は作成）
 */
function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

/**
 * プロセス状態を管理するオブジェクト
 */
export const StateManager = {
  /**
   * 状態を読み込む
   *
   * @param workspace ワークスペース名
   * @param process プロセス名
   * @returns プロセス状態（存在しない場合は null）
   */
  readState(workspace: string, process: string): ProcessState | null {
    const filePath = getStateFilePath(workspace, process);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ProcessState;
    } catch {
      // ファイルが破損している場合は null を返す
      return null;
    }
  },

  /**
   * 状態を書き込む
   *
   * @param workspace ワークスペース名
   * @param process プロセス名
   * @param state プロセス状態
   */
  writeState(workspace: string, process: string, state: ProcessState): void {
    ensureStateDir();

    const filePath = getStateFilePath(workspace, process);
    const content = JSON.stringify(state, null, 2);
    writeFileSync(filePath, content, 'utf-8');
  },

  /**
   * 状態を削除する
   *
   * @param workspace ワークスペース名
   * @param process プロセス名
   */
  deleteState(workspace: string, process: string): void {
    const filePath = getStateFilePath(workspace, process);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  },

  /**
   * すべての状態ファイルを読み込む
   *
   * @returns すべてのプロセス状態の配列
   */
  listAllStates(): ProcessState[] {
    ensureStateDir();

    const states: ProcessState[] = [];

    if (!existsSync(STATE_DIR)) {
      return states;
    }

    try {
      const files = readdirSync(STATE_DIR);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(STATE_DIR, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const state = JSON.parse(content) as ProcessState;
          states.push(state);
        } catch {
          // 破損したファイルはスキップ
          continue;
        }
      }
    } catch {
      // ディレクトリが読めない場合は空配列を返す
      return states;
    }

    return states;
  },
};
