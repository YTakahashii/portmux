import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { kill } from 'process';
import { StateManager, type ProcessState, type ProcessStatus } from '../state/state-manager.js';
import { isPidAlive } from '../state/pid-checker.js';
import { ConfigManager } from '../config/config-manager.js';
import { PortManager } from '../port/port-manager.js';
import { openSync, closeSync } from 'fs';
import { PortmuxError } from '../errors.js';

/**
 * プロセス起動オプション
 */
export interface ProcessStartOptions {
  cwd?: string;
  env?: Record<string, string>;
  projectRoot?: string; // portmux.config.json が存在するディレクトリ
  ports?: number[]; // 使用するポート番号の配列
  groupKey?: string; // Repository path (from global config) for display
}

/** プロセス起動エラー */
export class ProcessStartError extends PortmuxError {
  override readonly name = 'ProcessStartError';
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
  }
}

/** プロセス停止エラー */
export class ProcessStopError extends PortmuxError {
  override readonly name = 'ProcessStopError';
}

/** プロセス再起動エラー */
export class ProcessRestartError extends PortmuxError {
  override readonly name = 'ProcessRestartError';
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * プロセス状態情報
 */
export interface ProcessInfo {
  group: string;
  groupKey?: string;
  process: string;
  status: ProcessStatus;
  pid?: number;
  logPath?: string;
}

/**
 * プロセス管理を行うオブジェクト
 */
export const ProcessManager = {
  /**
   * プロセスを起動する
   *
   * @param group グループ名
   * @param processName プロセス名
   * @param command 実行するコマンド
   * @param options 起動オプション
   * @throws ProcessStartError 起動に失敗した場合
   */
  async startProcess(
    group: string,
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
          group,
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
    const existingState = StateManager.readState(group, processName);
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
        StateManager.deleteState(group, processName);
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
    const logPath = StateManager.generateLogPath(group, processName);

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
      group,
      groupKey: options.groupKey ?? group,
      process: processName,
      status: 'Running',
      pid,
      startedAt,
      logPath,
      ...(options.ports !== undefined && { ports: options.ports }),
    };
    StateManager.writeState(group, processName, state);
  },

  /**
   * プロセスを停止する
   *
   * @param group グループ名
   * @param processName プロセス名
   * @param timeout タイムアウト時間（ミリ秒、デフォルト: 10000）
   * @throws ProcessStopError 停止に失敗した場合
   */
  async stopProcess(group: string, processName: string, timeout = 10000): Promise<void> {
    const state = StateManager.readState(group, processName);
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      PortManager.releaseReservationByProcess(group, processName);
      cleaned = true;
    };

    if (!state) {
      throw new ProcessStopError(`プロセス "${processName}" の状態が見つかりません`);
    }

    try {
      if (state.status === 'Stopped') {
        // 既に停止している場合は状態を削除
        StateManager.deleteState(group, processName);
        cleanup();
        return;
      }

      if (!state.pid) {
        // PID が記録されていない場合は状態を削除して終了
        StateManager.deleteState(group, processName);
        cleanup();
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
        StateManager.writeState(group, processName, stoppedState);
        // 状態ファイルを削除（停止済みは保持しない）
        StateManager.deleteState(group, processName);
        cleanup();
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
          StateManager.writeState(group, processName, stoppedState);
          // 状態ファイルを削除
          StateManager.deleteState(group, processName);
          cleanup();
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
        StateManager.writeState(group, processName, stoppedState);
        StateManager.deleteState(group, processName);
        cleanup();
      } else {
        throw new ProcessStopError(
          `プロセス "${processName}" (PID: ${String(pid)}) の停止に失敗しました。` + 'SIGKILL でも終了しませんでした。'
        );
      }
    } finally {
      cleanup();
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
          StateManager.writeState(state.group, state.process, updatedState);
          // 状態ファイルを削除
          StateManager.deleteState(state.group, state.process);
          status = 'Stopped';
        }
      }

      processes.push({
        group: state.group,
        ...(state.groupKey !== undefined && { groupKey: state.groupKey }),
        process: state.process,
        status,
        ...(state.pid !== undefined && { pid: state.pid }),
        ...(state.logPath !== undefined && { logPath: state.logPath }),
      });
    }

    return processes;
  },

  /**
   * プロセスを再起動する
   *
   * @param group グループ名
   * @param processName プロセス名
   * @param command 実行するコマンド
   * @param options 起動オプション
   * @throws ProcessRestartError 再起動に失敗した場合
   */
  async restartProcess(
    group: string,
    processName: string,
    command: string,
    options: ProcessStartOptions = {}
  ): Promise<void> {
    const restartPlan = {
      previousState: StateManager.readState(group, processName),
    };

    try {
      if (restartPlan.previousState) {
        await this.stopProcess(group, processName);
      }
    } catch (error) {
      throw new ProcessRestartError(`プロセス "${processName}" の停止に失敗しました`, error);
    }

    try {
      await this.startProcess(group, processName, command, options);
    } catch (error) {
      const errorState: ProcessState = {
        group,
        groupKey: options.groupKey ?? restartPlan.previousState?.groupKey ?? group,
        process: processName,
        status: 'Error',
        error: error instanceof Error ? error.message : String(error),
        ...(restartPlan.previousState?.logPath !== undefined && { logPath: restartPlan.previousState.logPath }),
        ...(restartPlan.previousState?.ports !== undefined && { ports: restartPlan.previousState.ports }),
      };
      StateManager.writeState(group, processName, errorState);
      throw new ProcessRestartError(`プロセス "${processName}" の再起動に失敗しました`, error);
    }
  },
};
