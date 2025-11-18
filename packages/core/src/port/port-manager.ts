import { StateManager } from '../state/state-manager.js';
import { check as checkPortUsed } from 'tcp-port-used';
import { isPidAlive } from '../state/pid-checker.js';
import { randomBytes } from 'crypto';
import { PortmuxError } from '../errors.js';

/**
 * ポートが使用中の場合のエラー
 */
export class PortInUseError extends PortmuxError {
  override readonly name = 'PortInUseError';
  constructor(port: number) {
    super(`ポート ${String(port)} は既に使用されています`);
  }
}

/**
 * ポート予約リクエスト
 */
export interface PortReservationRequest {
  workspace: string;
  process: string;
  ports: number[];
}

/**
 * ポート予約プラン
 */
export interface PortReservationPlan {
  reservationToken: string;
  warnings: string[];
}

/**
 * ポート予約メタデータ
 */
export interface PortReservationMetadata {
  pid: number;
  startedAt: string;
}

/**
 * ポート予約情報（状態ストアに保存）
 */
export interface PortReservation {
  workspace: string;
  process: string;
  ports: number[];
  pid?: number;
  reservedAt: string;
  startedAt?: string;
}

/**
 * 一時的なポート予約情報（commitまでの保留中）
 */
const pendingReservations = new Map<string, PortReservation>();

/**
 * ポート管理を行うオブジェクト
 */
export const PortManager = {
  /**
   * ポートの使用可能性をチェックする
   *
   * @param ports チェックするポート番号の配列
   * @throws PortInUseError 使用中のポートがある場合
   */
  async checkPortAvailability(ports: number[]): Promise<void> {
    const unavailablePorts: number[] = [];

    for (const port of ports) {
      const inUse = await checkPortUsed(port);
      if (inUse) {
        unavailablePorts.push(port);
      }
    }

    if (unavailablePorts.length > 0) {
      const firstPort = unavailablePorts[0];
      if (firstPort !== undefined) {
        throw new PortInUseError(firstPort);
      }
    }
  },

  /**
   * 状態ストアの予約とリクエストが競合しないかの確認
   */
  checkReservationConflicts(existing: Map<string, PortReservation>, request: PortReservationRequest): void {
    for (const reservation of existing.values()) {
      const conflictPort = reservation.ports.find((port) => request.ports.includes(port));
      if (conflictPort !== undefined) {
        throw new PortInUseError(conflictPort);
      }
    }
  },

  /**
   * 状態ストアからポート予約情報を読み込む
   */
  loadReservationsFromState(): Map<string, PortReservation> {
    const reservations = new Map<string, PortReservation>();
    const states = StateManager.listAllStates();

    for (const state of states) {
      if (state.status === 'Running' && state.pid) {
        const ports: number[] = state.ports ?? [];
        const reservation: PortReservation = {
          workspace: state.workspace,
          process: state.process,
          ports,
          pid: state.pid,
          reservedAt: state.startedAt ?? new Date().toISOString(),
          ...(state.startedAt && { startedAt: state.startedAt }),
        };
        const key = `${state.workspace}:${state.process}`;
        reservations.set(key, reservation);
      }
    }

    return reservations;
  },

  /**
   * 孤立したポート予約を解放（PID が死んでいる場合）
   */
  reconcileFromState(): void {
    const reservations = this.loadReservationsFromState();

    for (const reservation of reservations.values()) {
      if (reservation.pid && !isPidAlive(reservation.pid)) {
        // PID が死んでいる場合は状態を削除
        StateManager.deleteState(reservation.workspace, reservation.process);
      }
    }
  },

  /**
   * ポート予約の計画を立てる（2フェーズコミットの Phase 1）
   *
   * @param request ポート予約リクエスト
   * @returns ポート予約プラン
   * @throws PortInUseError ポートが使用中の場合
   */
  async planReservation(request: PortReservationRequest): Promise<PortReservationPlan> {
    const warnings: string[] = [];

    // ポートの使用可能性をチェック
    await this.checkPortAvailability(request.ports);

    // 状態ストアから既存の予約を読み込み
    const existingReservations = this.loadReservationsFromState();
    const existingKey = `${request.workspace}:${request.process}`;
    const existingReservation = existingReservations.get(existingKey);

    if (existingReservation) {
      warnings.push(
        `プロセス "${request.process}" は既に起動しています。` + `既存のプロセスを停止してから起動してください。`
      );
    }

    // 既存予約とのポート競合を確認（状態ストアベース）
    this.checkReservationConflicts(existingReservations, request);

    // 予約トークンを生成
    const reservationToken = randomBytes(16).toString('hex');

    // 一時予約を作成
    const reservation: PortReservation = {
      workspace: request.workspace,
      process: request.process,
      ports: request.ports,
      reservedAt: new Date().toISOString(),
    };

    pendingReservations.set(reservationToken, reservation);

    return {
      reservationToken,
      warnings,
    };
  },

  /**
   * ポート予約を確定する（2フェーズコミットの Phase 2）
   *
   * @param reservationToken 予約トークン
   */
  commitReservation(reservationToken: string): void {
    const reservation = pendingReservations.get(reservationToken);
    if (!reservation) {
      throw new Error(`無効な予約トークンです: ${reservationToken}`);
    }

    // 状態ストアに保存（現在は StateManager が処理）
    // 将来的にはポート情報も状態ストアに保存する

    // 一時予約を削除
    pendingReservations.delete(reservationToken);
  },

  /**
   * ポート予約を解放する
   *
   * @param reservationToken 予約トークン（保留中の場合）
   */
  releaseReservation(reservationToken?: string): void {
    if (reservationToken) {
      pendingReservations.delete(reservationToken);
    }
  },

  /**
   * ワークスペース・プロセス名でポート予約を解放
   */
  releaseReservationByProcess(workspace: string, process: string): void {
    // 保留中の予約を削除
    for (const [token, reservation] of pendingReservations.entries()) {
      if (reservation.workspace === workspace && reservation.process === process) {
        pendingReservations.delete(token);
      }
    }

    // 状態ストアから削除（StateManager も保持しているためクリアしておく）
    StateManager.deleteState(workspace, process);
  },
};
