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
  group: string;
  groupKey?: string;
  process: string;
  status: ProcessStatus;
  pid?: number;
  error?: string;
  startedAt?: string; // ISO 8601形式の日時文字列
  stoppedAt?: string; // ISO 8601形式の日時文字列
  logPath?: string; // ログファイルのパス
  ports?: number[]; // 使用しているポート番号
}

function getPortmuxDir(): string {
  return join(homedir(), '.config', 'portmux');
}

/**
 * 状態ファイルのベースディレクトリ
 */
export function getStateDir(): string {
  return join(getPortmuxDir(), 'state');
}

/**
 * ログファイルのベースディレクトリ
 */
export function getLogDir(): string {
  return join(getPortmuxDir(), 'logs');
}

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
function getStateFilePath(group: string, process: string): string {
  const groupSlug = slugify(group);
  const processSlug = slugify(process);
  const filename = `${groupSlug}-${processSlug}.json`;
  return join(getStateDir(), filename);
}

/**
 * 状態ディレクトリを確保（存在しない場合は作成）
 */
function ensureStateDir(): void {
  const stateDir = getStateDir();
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}

/**
 * ログディレクトリを確保（存在しない場合は作成）
 */
function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * ログファイルのパスを生成
 * ファイル名: <group-slug>-<process-slug>-<hash>.log
 */
function generateLogPath(group: string, process: string): string {
  ensureLogDir();

  const groupSlug = slugify(group);
  const processSlug = slugify(process);

  // ハッシュを付与（同一名でも衝突を避ける）
  const hash = Date.now().toString(36);
  const filename = `${groupSlug}-${processSlug}-${hash}.log`;

  return join(getLogDir(), filename);
}

/**
 * プロセス状態を管理するオブジェクト
 */
export const StateManager = {
  /**
   * ログファイルのパスを生成
   *
   * @param group グループ名
   * @param process プロセス名
   * @returns ログファイルのパス
   */
  generateLogPath(group: string, process: string): string {
    return generateLogPath(group, process);
  },

  /**
   * 状態を読み込む
   *
   * @param group グループ名
   * @param process プロセス名
   * @returns プロセス状態（存在しない場合は null）
   */
  readState(group: string, process: string): ProcessState | null {
    const filePath = getStateFilePath(group, process);

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
   * @param group グループ名
   * @param process プロセス名
   * @param state プロセス状態
   */
  writeState(group: string, process: string, state: ProcessState): void {
    ensureStateDir();

    const filePath = getStateFilePath(group, process);
    const content = JSON.stringify(state, null, 2);
    writeFileSync(filePath, content, 'utf-8');
  },

  /**
   * 状態を削除する
   *
   * @param group グループ名
   * @param process プロセス名
   */
  deleteState(group: string, process: string): void {
    const filePath = getStateFilePath(group, process);

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
    const stateDir = getStateDir();

    if (!existsSync(stateDir)) {
      return states;
    }

    try {
      const files = readdirSync(stateDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(stateDir, file);
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
