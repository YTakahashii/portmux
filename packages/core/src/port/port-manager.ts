import { check as checkPortUsed } from 'tcp-port-used';

/**
 * ポートが使用中の場合のエラー
 */
export class PortInUseError extends Error {
  constructor(port: number) {
    super(`ポート ${String(port)} は既に使用されています`);
    this.name = 'PortInUseError';
  }
}

/**
 * ポート管理を行うクラス
 */
export class PortManager {
  /**
   * ポートの使用可能性をチェックする
   *
   * @param ports チェックするポート番号の配列
   * @throws PortInUseError 使用中のポートがある場合
   */
  static async checkPortAvailability(ports: number[]): Promise<void> {
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
  }
}
