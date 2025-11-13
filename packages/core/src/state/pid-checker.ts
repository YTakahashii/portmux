import { existsSync, readFileSync } from 'fs';

import { execSync } from 'child_process';
import { kill } from 'process';
import { platform } from 'os';

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
  } catch {
    // ESRCH (No such process) エラーの場合はプロセスが存在しない
    return false;
  }
}

/**
 * PID のコマンドラインを取得
 *
 * @param pid プロセスID
 * @returns コマンドライン（取得できない場合は null）
 */
export function getCommandLine(pid: number): string | null {
  const os = platform();

  try {
    if (os === 'linux') {
      // Linux: /proc/<pid>/cmdline
      const cmdlinePath = `/proc/${String(pid)}/cmdline`;
      if (!existsSync(cmdlinePath)) {
        return null;
      }

      const cmdline = readFileSync(cmdlinePath, 'utf-8');
      // null 文字で区切られているため、スペースに置換
      return cmdline.replace(/\0/g, ' ').trim();
    } else if (os === 'darwin') {
      // macOS: ps -p <pid> -o command
      const output = execSync(`ps -p ${String(pid)} -o command=`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      return output.trim();
    } else if (os === 'win32') {
      // Windows: wmic process where ProcessId=<pid> get CommandLine
      const output = execSync(`wmic process where ProcessId=${String(pid)} get CommandLine`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      // ヘッダー行を除去
      const lines = output.split('\n').filter((line) => line.trim() && !line.startsWith('CommandLine'));
      return lines[0]?.trim() ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * PID が指定されたコマンドで起動されたものか確認
 * コマンドラインの一致を確認することで、PID の再利用を検出する
 *
 * @param pid プロセスID
 * @param expectedCommand 期待されるコマンド
 * @returns 一致する場合は true、そうでない場合は false
 */
export function verifyPidCommand(pid: number, expectedCommand: string): boolean {
  const actualCommand = getCommandLine(pid);

  if (!actualCommand) {
    return false;
  }

  // 完全一致または部分一致で確認
  // シェル経由で実行される場合、実際のコマンドラインには sh -c などが含まれるため部分一致で確認
  return actualCommand.includes(expectedCommand) || expectedCommand.includes(actualCommand);
}

/**
 * PID が生存しており、かつ指定されたコマンドで起動されたものか確認
 *
 * @param pid プロセスID
 * @param expectedCommand 期待されるコマンド（省略時は生存確認のみ）
 * @returns 生存しており、コマンドも一致する場合は true、そうでない場合は false
 */
export function isPidAliveAndValid(pid: number, expectedCommand?: string): boolean {
  // まず生存確認
  if (!isPidAlive(pid)) {
    return false;
  }

  // コマンドの確認（指定されている場合のみ）
  if (expectedCommand) {
    return verifyPidCommand(pid, expectedCommand);
  }

  return true;
}
