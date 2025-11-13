import { type PortMuxConfig, PortMuxConfigSchema } from './schema.js';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

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
 * 設定ファイルを管理するクラス
 */
export class ConfigManager {
  /**
   * カレントディレクトリから親ディレクトリを遡って portmux.config.json を探す
   *
   * @param startDir 検索を開始するディレクトリ（デフォルト: process.cwd()）
   * @returns 設定ファイルのパス
   * @throws ConfigNotFoundError 設定ファイルが見つからない場合
   */
  static findConfigFile(startDir: string = process.cwd()): string {
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
  }

  /**
   * 設定ファイルを読み込んでバリデーションを行う
   *
   * @param configPath 設定ファイルのパス（省略時は自動検索）
   * @returns バリデーション済みの設定オブジェクト
   * @throws ConfigNotFoundError ファイルが存在しない場合
   * @throws ConfigParseError JSONパースに失敗した場合
   * @throws ConfigValidationError スキーマバリデーションに失敗した場合
   */
  static loadConfig(configPath?: string): PortMuxConfig {
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
      const details = result.error.errors
        .map((err: { path: (string | number)[]; message: string }) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new ConfigValidationError(path, details);
    }

    return result.data;
  }
}
