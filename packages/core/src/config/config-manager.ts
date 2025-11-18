import { type PortMuxConfig, PortMuxConfigSchema, type GlobalConfig, GlobalConfigSchema } from './schema.js';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

/**
 * 設定ファイルが見つからない場合のエラー
 */
export class ConfigNotFoundError extends Error {
  constructor(path: string) {
    super(`設定ファイルが見つかりません: ${path}`);
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * 設定ファイルのJSONパースエラー
 */
export class ConfigParseError extends Error {
  constructor(path: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`設定ファイルのパースに失敗しました: ${path}\n${message}`);
    this.name = 'ConfigParseError';
  }
}

/**
 * 設定ファイルのスキーマバリデーションエラー
 */
export class ConfigValidationError extends Error {
  constructor(path: string, details: string) {
    super(`設定ファイルのバリデーションに失敗しました: ${path}\n${details}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * バージョン非互換エラー
 */
export class VersionMismatchError extends Error {
  constructor(
    public readonly configVersion: string,
    public readonly supportedVersion: string
  ) {
    super(
      `設定ファイルのバージョンが非互換です。\n` +
        `設定ファイルバージョン: ${configVersion}\n` +
        `サポートされているバージョン: ${supportedVersion}\n` +
        `設定ファイルを更新してください。`
    );
    this.name = 'VersionMismatchError';
  }
}

/** Duplicate repository name error. */
export class DuplicateRepositoryNameError extends Error {
  constructor(workspaceName: string) {
    super(`リポジトリ名が重複しています: ${workspaceName}\nグローバル設定のリポジトリ名は一意である必要があります。`);
    this.name = 'DuplicateRepositoryNameError';
  }
}

/** Invalid repository reference error. */
export class InvalidRepositoryReferenceError extends Error {
  constructor(
    public readonly workspaceName: string,
    public readonly referencedWorkspace: string,
    public readonly projectConfigPath: string
  ) {
    super(
      `無効なリポジトリ参照です。\n` +
        `グローバル設定のリポジトリ "${workspaceName}" が参照している ` +
        `プロジェクト設定内のワークスペース "${referencedWorkspace}" が見つかりません。\n` +
        `プロジェクト設定: ${projectConfigPath}`
    );
    this.name = 'InvalidRepositoryReferenceError';
  }
}

/**
 * サポートされている設定ファイルのバージョン
 */
const SUPPORTED_VERSION = '1.0.0';

/**
 * バージョン文字列をパースして major, minor, patch を返す
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split('.');
  return {
    major: parseInt(parts[0] ?? '0', 10),
    minor: parseInt(parts[1] ?? '0', 10),
    patch: parseInt(parts[2] ?? '0', 10),
  };
}

/**
 * 環境変数を解決する
 * ${VAR} 形式の変数を process.env から置換
 *
 * @param value 置換対象の文字列
 * @param commandEnv コマンド定義の env
 * @returns 解決済みの文字列
 */
function resolveEnvVariables(value: string, commandEnv: Record<string, string> = {}): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    // 優先順位: 1. commandEnv, 2. process.env
    const resolved = commandEnv[varName] ?? process.env[varName];

    if (resolved === undefined) {
      console.warn(`警告: 環境変数 "${varName}" が定義されていません。空文字列で置換します。`);
      return '';
    }

    return resolved;
  });
}

/**
 * 設定ファイルを管理するオブジェクト
 */
export const ConfigManager = {
  /**
   * グローバル設定ファイルのパスを取得
   */
  getGlobalConfigPath(): string {
    return join(homedir(), '.config', 'portmux', 'config.json');
  },

  /**
   * カレントディレクトリから親ディレクトリを遡って portmux.config.json を探す
   *
   * @param startDir 検索を開始するディレクトリ（デフォルト: process.cwd()）
   * @returns 設定ファイルのパス
   * @throws ConfigNotFoundError 設定ファイルが見つからない場合
   */
  findConfigFile(startDir: string = process.cwd()): string {
    let currentDir = resolve(startDir);
    const root = resolve('/');

    while (currentDir !== root) {
      const configPath = join(currentDir, 'portmux.config.json');
      if (existsSync(configPath)) {
        return configPath;
      }
      currentDir = dirname(currentDir);
    }

    throw new ConfigNotFoundError('portmux.config.json');
  },

  /**
   * バージョンをチェックして互換性を検証
   *
   * @param configVersion 設定ファイルのバージョン
   * @throws VersionMismatchError メジャーバージョンが異なる場合
   */
  validateVersion(configVersion: string): void {
    const config = parseVersion(configVersion);
    const supported = parseVersion(SUPPORTED_VERSION);

    // メジャーバージョンが異なる場合はエラー
    if (config.major !== supported.major) {
      throw new VersionMismatchError(configVersion, SUPPORTED_VERSION);
    }

    // マイナーバージョンが新しい場合は警告（console.warn）
    if (config.minor > supported.minor) {
      console.warn(
        `警告: 設定ファイルのバージョン (${configVersion}) が ` +
          `サポートされているバージョン (${SUPPORTED_VERSION}) より新しいです。\n` +
          `一部の機能が正常に動作しない可能性があります。`
      );
    }
  },

  /**
   * グローバル設定ファイルを読み込む
   *
   * @returns グローバル設定（存在しない場合は null）
   * @throws ConfigParseError JSONパースに失敗した場合
   * @throws ConfigValidationError スキーマバリデーションに失敗した場合
   */
  loadGlobalConfig(): GlobalConfig | null {
    const path = this.getGlobalConfigPath();

    // ファイルが存在しない場合は null を返す
    if (!existsSync(path)) {
      return null;
    }

    // ファイルの読み込み
    let rawContent: string;
    try {
      rawContent = readFileSync(path, 'utf-8');
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // JSONパース
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(rawContent);
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // Zodバリデーション
    const result = GlobalConfigSchema.safeParse(jsonData);
    if (!result.success) {
      const details = result.error.issues.map((err) => `${err.path.map(String).join('.')}: ${err.message}`).join('\n');
      throw new ConfigValidationError(path, details);
    }

    // バージョン検証
    this.validateVersion(result.data.version);

    return result.data;
  },

  /**
   * プロジェクト設定ファイルを読み込んでバリデーションを行う
   *
   * @param configPath 設定ファイルのパス（省略時は自動検索）
   * @returns バリデーション済みの設定オブジェクト
   * @throws ConfigNotFoundError ファイルが存在しない場合
   * @throws ConfigParseError JSONパースに失敗した場合
   * @throws ConfigValidationError スキーマバリデーションに失敗した場合
   */
  loadConfig(configPath?: string): PortMuxConfig {
    const path = configPath ?? this.findConfigFile();

    // ファイルの存在確認
    if (!existsSync(path)) {
      throw new ConfigNotFoundError(path);
    }

    // ファイルの読み込み
    let rawContent: string;
    try {
      rawContent = readFileSync(path, 'utf-8');
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // JSONパース
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(rawContent);
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // Zodバリデーション
    const result = PortMuxConfigSchema.safeParse(jsonData);
    if (!result.success) {
      const details = result.error.issues.map((err) => `${err.path.map(String).join('.')}: ${err.message}`).join('\n');
      throw new ConfigValidationError(path, details);
    }

    // バージョン検証
    this.validateVersion(result.data.version);

    return result.data;
  },

  /**
   * Validate consistency between global and project configurations.
   *
   * @param globalConfig Global configuration
   * @param projectConfig Project configuration
   * @param projectConfigPath Path to the project configuration (used in error messages)
   * @throws DuplicateRepositoryNameError When repository names are duplicated
   * @throws InvalidRepositoryReferenceError When a repository points to a missing workspace definition
   */
  validateGlobalConfig(globalConfig: GlobalConfig, projectConfig: PortMuxConfig, projectConfigPath: string): void {
    // リポジトリ名の一意性チェック
    const repositoryNames = new Set<string>();
    for (const name of Object.keys(globalConfig.repositories)) {
      if (repositoryNames.has(name)) {
        throw new DuplicateRepositoryNameError(name);
      }
      repositoryNames.add(name);
    }

    // 外部参照の整合性チェック
    for (const [repositoryName, repository] of Object.entries(globalConfig.repositories)) {
      if (!projectConfig.workspaces[repository.workspace]) {
        throw new InvalidRepositoryReferenceError(repositoryName, repository.workspace, projectConfigPath);
      }
    }
  },

  /**
   * コマンド文字列内の環境変数を解決
   *
   * @param command コマンド文字列
   * @param commandEnv コマンド定義の env
   * @returns 解決済みのコマンド文字列
   */
  resolveCommandEnv(command: string, commandEnv: Record<string, string> = {}): string {
    return resolveEnvVariables(command, commandEnv);
  },

  /**
   * 環境変数オブジェクトを解決
   * env の値に ${VAR} が含まれている場合、再帰的に解決
   *
   * @param commandEnv コマンド定義の env
   * @returns 解決済みの環境変数オブジェクト
   */
  resolveEnvObject(commandEnv: Record<string, string> = {}): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(commandEnv)) {
      resolved[key] = resolveEnvVariables(value, commandEnv);
    }

    return resolved;
  },
};
