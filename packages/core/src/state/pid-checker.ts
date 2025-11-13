import { kill } from 'process';

/**
 * PID が生存しているか確認する
 *
 * @param pid プロセスID
 * @returns 生存している場合は true、そうでない場合は false
 */
export function isPidAlive(pid: number): boolean {
  try {
    // signal 0 を送信すると、プロセスの存在確認のみを行う
    // プロセスが存在しない場合はエラーが発生する
    kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH (No such process) エラーの場合はプロセスが存在しない
    return false;
  }
}
