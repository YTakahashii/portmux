/**
 * PortMux の基底エラークラス
 */
export class PortmuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortmuxError';
    Object.setPrototypeOf(this, PortmuxError.prototype);
  }
}

/**
 * 設定関連のエラー
 */
export class ConfigError extends PortmuxError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

/**
 * プロセス関連のエラー
 */
export class ProcessError extends PortmuxError {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessError';
    Object.setPrototypeOf(this, ProcessError.prototype);
  }
}

/**
 * 状態管理関連のエラー
 */
export class StateError extends PortmuxError {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
    Object.setPrototypeOf(this, StateError.prototype);
  }
}
