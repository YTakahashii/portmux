import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { kill } from 'process';
import { StateManager, type ProcessState, type ProcessStatus } from '../state/state-manager.js';
import { isPidAlive } from '../state/pid-checker.js';
import { ConfigManager } from '../config/config-manager.js';
import { PortManager } from '../port/port-manager.js';
import { existsSync, statSync, renameSync, unlinkSync, openSync, closeSync } from 'fs';

/**
 * プロセス起動オプション
 */
export interface ProcessStartOptions {
  cwd?: string;
  env?: Record<string, string>;
  projectRoot?: string; // portmux.config.json が存在するディレクトリ
  ports?: number[]; // 使用するポート番号の配列
}

/**
 * プロセス起動エラー
 */
export class ProcessStartError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProcessStartError';
  }
}

/**
 * プロセス停止エラー
 */
export class ProcessStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessStopError';
  }
}

/**
 * プロセス状態情報
 */
export interface ProcessInfo {
  workspace: string;
  process: string;
  status: ProcessStatus;
  pid?: number;
  logPath?: string;
}

/**
 * ログローテーションの設定
 */
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_MAX_ROTATIONS = 5; // 最大5世代

/**
 * ログファイルのローテーション処理
 * 既存のログファイルが MAX_SIZE を超えている場合、ローリングする
 */
function rotateLogFile(logPath: string): void {
  if (!existsSync(logPath)) {
    return;
  }

  const stats = statSync(logPath);
  if (stats.size < LOG_MAX_SIZE) {
    return;
  }

  // 既存のローテーションファイルをシフト
  for (let i = LOG_MAX_ROTATIONS - 1; i >= 1; i--) {
    const oldPath = `${logPath}.${String(i)}`;
    const newPath = `${logPath}.${String(i + 1)}`;

    if (existsSync(oldPath)) {
      if (i === LOG_MAX_ROTATIONS - 1) {
        // 最古のファイルは削除
        unlinkSync(oldPath);
      } else {
        renameSync(oldPath, newPath);
      }
    }
  }

  // 現在のログファイルを .1 にリネーム
  renameSync(logPath, `${logPath}.1`);
}

/**
 * プロセス管理を行うオブジェクト
 */
export const ProcessManager = {
  /**
   * プロセスを起動する
   *
   * @param workspace ワークスペース名
   * @param processName プロセス名
   * @param command 実行するコマンド
   * @param options 起動オプション
   * @throws ProcessStartError 起動に失敗した場合
   */
  async startProcess(
    workspace: string,
    processName: string,
    command: string,
    options: ProcessStartOptions = {}
  ): Promise<void> {
    // 状態整合性チェック
    PortManager.reconcileFromState();

    // ポート予約の計画を立てる
    let reservationToken: string | undefined;
    if (options.ports && options.ports.length > 0) {
      try {
        const plan = await PortManager.planReservation({
          workspace,
          process: processName,
          ports: options.ports,
        });

        reservationToken = plan.reservationToken;

        // 警告があれば表示
        for (const warning of plan.warnings) {
          console.warn(`警告: ${warning}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new ProcessStartError(`ポート予約に失敗しました: ${error.message}`, error);
        }
        throw error;
      }
    }

    // 既存のプロセスをチェック
    const existingState = StateManager.readState(workspace, processName);
    if (existingState?.status === 'Running') {
      if (existingState.pid && isPidAlive(existingState.pid)) {
        // ポート予約を解放
        if (reservationToken) {
          PortManager.releaseReservation(reservationToken);
        }
        throw new ProcessStartError(
          `プロセス "${processName}" は既に起動しています (PID: ${String(existingState.pid)})`
        );
      } else {
        // PID が死んでいる場合は状態をクリア
        StateManager.deleteState(workspace, processName);
      }
    }

    // プロジェクトルートを取得（設定ファイルから）
    let projectRoot = options.projectRoot;
    if (!projectRoot) {
      try {
        const configPath = ConfigManager.findConfigFile();
        projectRoot = resolve(configPath, '..');
      } catch (error) {
        throw new ProcessStartError('設定ファイルが見つかりません。projectRoot を指定してください。', error);
      }
    }

    // cwd の解決（相対パスはプロジェクトルート基準）
    let cwd = projectRoot;
    if (options.cwd) {
      if (options.cwd.startsWith('/')) {
        cwd = options.cwd;
      } else {
        cwd = resolve(projectRoot, options.cwd);
      }
    }

    // 環境変数のマージ
    // options.env には設定ファイルで定義された環境変数が含まれる
    // ConfigManager で解決済みの値がここに渡される想定
    const env = {
      ...process.env,
      ...options.env,
    };

    // ログファイルの準備
    const logPath = StateManager.generateLogPath(workspace, processName);

    // ログローテーション（既存ログが大きい場合）
    rotateLogFile(logPath);

    // ログファイルのファイルディスクリプタを取得
    let logFd: number;
    try {
      logFd = openSync(logPath, 'a', 0o600);
    } catch (error) {
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError(`ログファイルの作成に失敗しました: ${logPath}`, error);
    }

    // プロセスを起動（シェル経由で実行）
    let childProcess: ChildProcess;
    try {
      // shell オプションを true にすることで、シェル経由でコマンドを実行
      // これにより、複雑なコマンド（引用符、パイプなど）にも対応できる
      childProcess = spawn(command, {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', logFd, logFd], // stdout/stderr をログファイルへ直接書き込む
        shell: true, // シェル経由で実行
      });

      // プロセスを独立したプロセスグループに分離
      childProcess.unref();
      // 親プロセス側のログファイルディスクリプタは不要なため即時クローズ
      closeSync(logFd);
    } catch (error) {
      closeSync(logFd);
      // ポート予約を解放
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError(`プロセスの起動に失敗しました: ${command}`, error);
    }

    // PID を取得
    const pid = childProcess.pid;
    if (!pid) {
      // ポート予約を解放
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError('プロセスの PID を取得できませんでした');
    }

    // 起動確認（2秒待機 + PID 生存確認）
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!isPidAlive(pid)) {
      // ポート予約を解放
      if (reservationToken) {
        PortManager.releaseReservation(reservationToken);
      }
      throw new ProcessStartError(`プロセスが起動直後に終了しました (PID: ${String(pid)})`);
    }

    const startedAt = new Date().toISOString();

    // ポート予約を確定
    if (reservationToken) {
      PortManager.commitReservation(reservationToken);
    }

    // 状態を保存
    const state: ProcessState = {
      workspace,
      process: processName,
      status: 'Running',
      pid,
      startedAt,
      logPath,
    };
    StateManager.writeState(workspace, processName, state);
  },

  /**
   * プロセスを停止する
   *
   * @param workspace ワークスペース名
   * @param processName プロセス名
   * @param timeout タイムアウト時間（ミリ秒、デフォルト: 10000）
   * @throws ProcessStopError 停止に失敗した場合
   */
  async stopProcess(workspace: string, processName: string, timeout = 10000): Promise<void> {
    const state = StateManager.readState(workspace, processName);

    if (!state) {
      throw new ProcessStopError(`プロセス "${processName}" の状態が見つかりません`);
    }

    if (state.status === 'Stopped') {
      // 既に停止している場合は状態を削除
      StateManager.deleteState(workspace, processName);
      // ポート予約を解放
      PortManager.releaseReservationByProcess();
      return;
    }

    if (!state.pid) {
      // PID が記録されていない場合は状態を削除して終了
      StateManager.deleteState(workspace, processName);
      // ポート予約を解放
      PortManager.releaseReservationByProcess();
      return;
    }

    const pid = state.pid;

    // プロセスが既に死んでいる場合は状態を更新して終了
    if (!isPidAlive(pid)) {
      const stoppedState: ProcessState = {
        ...state,
        status: 'Stopped',
        stoppedAt: new Date().toISOString(),
      };
      StateManager.writeState(workspace, processName, stoppedState);
      // 状態ファイルを削除（停止済みは保持しない）
      StateManager.deleteState(workspace, processName);
      // ポート予約を解放
      PortManager.releaseReservationByProcess();
      return;
    }

    // SIGTERM を送信
    try {
      kill(pid, 'SIGTERM');
    } catch {
      throw new ProcessStopError(`プロセス "${processName}" (PID: ${String(pid)}) に SIGTERM を送信できませんでした`);
    }

    // プロセスが停止するまで待機（最大 timeout ミリ秒）
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (!isPidAlive(pid)) {
        // 停止した
        const stoppedState: ProcessState = {
          ...state,
          status: 'Stopped',
          stoppedAt: new Date().toISOString(),
        };
        StateManager.writeState(workspace, processName, stoppedState);
        // 状態ファイルを削除
        StateManager.deleteState(workspace, processName);
        // ポート予約を解放
        PortManager.releaseReservationByProcess();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms 待機
    }

    // タイムアウトした場合は SIGKILL を送信
    try {
      kill(pid, 'SIGKILL');
    } catch {
      // SIGKILL が失敗しても、プロセスが既に終了している可能性がある
    }

    // 最終確認
    if (!isPidAlive(pid)) {
      const stoppedState: ProcessState = {
        ...state,
        status: 'Stopped',
        stoppedAt: new Date().toISOString(),
      };
      StateManager.writeState(workspace, processName, stoppedState);
      StateManager.deleteState(workspace, processName);
      // ポート予約を解放
      PortManager.releaseReservationByProcess();
    } else {
      throw new ProcessStopError(`プロセス "${processName}" (PID: ${String(pid)}) の停止に失敗しました`);
    }
  },

  /**
   * すべてのプロセスの状態一覧を取得する
   *
   * @returns プロセス情報の配列
   */
  listProcesses(): ProcessInfo[] {
    const states = StateManager.listAllStates();
    const processes: ProcessInfo[] = [];

    for (const state of states) {
      // PID の生存確認
      let status: ProcessStatus = state.status;
      if (state.status === 'Running' && state.pid) {
        if (!isPidAlive(state.pid)) {
          // 死んでいる場合は状態を更新
          const updatedState: ProcessState = {
            ...state,
            status: 'Stopped',
            stoppedAt: new Date().toISOString(),
          };
          StateManager.writeState(state.workspace, state.process, updatedState);
          // 状態ファイルを削除
          StateManager.deleteState(state.workspace, state.process);
          status = 'Stopped';
        }
      }

      processes.push({
        workspace: state.workspace,
        process: state.process,
        status,
        ...(state.pid !== undefined && { pid: state.pid }),
        ...(state.logPath !== undefined && { logPath: state.logPath }),
      });
    }

    return processes;
  },
};
