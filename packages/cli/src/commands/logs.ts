import { StateManager } from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import { createReadStream, existsSync, readFileSync, statSync, watch } from 'fs';

interface LogsOptions {
  lines?: string;
  follow?: boolean;
  timestamps?: boolean;
}

export const logsCommand: ReturnType<typeof createLogsCommand> = createLogsCommand();

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function getTailLines(content: string, lineCount: number): string[] {
  if (lineCount === 0) {
    return [];
  }

  const lines = splitLines(content);
  if (lineCount >= lines.length) {
    return lines;
  }
  return lines.slice(lines.length - lineCount);
}

function formatLine(line: string, timestamps: boolean): string {
  if (!timestamps) {
    return line;
  }
  return `[${new Date().toISOString()}] ${line}`;
}

function printLines(lines: string[], timestamps: boolean): void {
  for (const line of lines) {
    console.log(formatLine(line, timestamps));
  }
}

function parseLineCount(value?: string): number {
  if (value === undefined) {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--lines には 0 以上の整数を指定してください');
  }
  return parsed;
}

function printAvailableProcesses(): void {
  const states = StateManager.listAllStates();
  if (states.length === 0) {
    console.log(chalk.yellow('実行中のプロセスがありません'));
    return;
  }

  console.log('利用可能なグループ/プロセス:');
  for (const state of states) {
    const repositoryLabel = state.groupKey ?? state.group;
    const repositorySuffix =
      state.groupKey && state.groupKey !== state.group ? ` (${state.group})` : '';
    console.log(`  - ${repositoryLabel}${repositorySuffix}/${state.process}`);
  }
}

export function runLogsCommand(
  groupName: string | undefined,
  processName: string | undefined,
  options: LogsOptions
): void {
  try {
    if (!groupName || !processName) {
      console.error(chalk.red('エラー: グループ名とプロセス名を指定してください'));
      printAvailableProcesses();
      process.exit(1);
      return;
    }

    let lineCount: number;
    try {
      lineCount = parseLineCount(options.lines);
    } catch (error) {
      console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
      return;
    }

    const state = StateManager.readState(groupName, processName);
    if (!state) {
      console.error(
        chalk.red(`エラー: グループ "${groupName}" のプロセス "${processName}" は実行中ではありません`)
      );
      process.exit(1);
      return;
    }

    if (!state.logPath) {
      console.error(chalk.red(`エラー: プロセス "${processName}" のログファイルパスが見つかりません`));
      process.exit(1);
      return;
    }

    const logPath = state.logPath;
    if (!existsSync(logPath)) {
      console.error(chalk.red(`エラー: ログファイルが存在しません: ${logPath}`));
      process.exit(1);
      return;
    }

    const timestamps = options.timestamps === true;
    const follow = options.follow !== false;

    const initialContent = readFileSync(logPath, 'utf-8');
    const initialLines = getTailLines(initialContent, lineCount);
    printLines(initialLines, timestamps);

    let currentPosition = Buffer.byteLength(initialContent, 'utf-8');

    if (!follow) {
      return;
    }

    const watcher = watch(logPath, (eventType) => {
      if (eventType === 'rename') {
        console.error(chalk.red('エラー: ログファイルが移動または削除されました'));
        watcher.close();
        process.exit(1);
        return;
      }

      try {
        const stats = statSync(logPath);
        if (stats.size < currentPosition) {
          currentPosition = 0;
        }

        if (stats.size <= currentPosition) {
          return;
        }

        const stream = createReadStream(logPath, {
          encoding: 'utf-8',
          start: currentPosition,
          end: stats.size - 1,
        });

        let buffer = '';
        stream.on('data', (chunk) => {
          buffer += chunk.toString();
        });

        stream.on('end', () => {
          const lines = splitLines(buffer);
          printLines(lines, timestamps);
        });

        stream.on('error', (error) => {
          console.error(
            chalk.red(`エラー: ログの読み取りに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
          );
        });

        currentPosition = stats.size;
      } catch (error) {
        console.error(
          chalk.red(
            `エラー: ログファイルの監視に失敗しました: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    });
  } catch (error) {
    console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function createLogsCommand(): Command {
  return new Command('logs')
    .description('プロセスのログを表示します')
    .argument('[group-name]', 'グループ名')
    .argument('[process-name]', 'プロセス名')
    .option('-n, --lines <lines>', '末尾から表示する行数 (デフォルト: 50)', '50')
    .option('--no-follow', 'ログの追尾を無効にします')
    .option('-t, --timestamps', '各行にタイムスタンプを付与して表示します')
    .action((groupName: string, processName: string, cmdOptions: LogsOptions) => {
      runLogsCommand(groupName, processName, cmdOptions);
    });
}
