import { StateManager, type ProcessState, getLogDir } from '@portmux/core';
import { Command } from 'commander';
import { chalk } from '../lib/chalk.js';
import { createReadStream, existsSync, lstatSync, readFileSync, statSync, watch } from 'fs';
import { resolve, sep } from 'path';

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
    throw new Error('--lines must be an integer greater than or equal to 0');
  }
  return parsed;
}

function formatStateLabel(state: ProcessState): string {
  const label = state.groupLabel ?? state.repositoryName ?? state.group;
  const path = state.worktreePath ?? state.groupKey;
  if (path) {
    return `${label} (${path})`;
  }
  return label;
}

function printAvailableProcesses(): void {
  const states = StateManager.listAllStates();
  if (states.length === 0) {
    console.log(chalk.yellow('No running processes'));
    return;
  }

  console.log('Available groups/processes:');
  for (const state of states) {
    console.log(`  - ${formatStateLabel(state)}/${state.process}`);
  }
}

function filterStatesByIdentifier(states: ProcessState[], identifier: string): ProcessState[] {
  const directMatches = states.filter((state) => state.group === identifier || state.groupLabel === identifier);
  if (directMatches.length > 0) {
    return directMatches;
  }

  const repositoryMatches = states.filter((state) => state.repositoryName === identifier);
  if (repositoryMatches.length > 0) {
    return repositoryMatches;
  }

  const groupMatches = states.filter((state) => state.groupDefinitionName === identifier);
  if (groupMatches.length > 0) {
    return groupMatches;
  }

  const pathMatches = states.filter((state) => state.worktreePath === identifier || state.groupKey === identifier);
  if (pathMatches.length > 0) {
    return pathMatches;
  }

  return [];
}

function isSafeLogPath(logPath: string): boolean {
  const baseDir = resolve(getLogDir());
  const resolvedLogPath = resolve(logPath);

  if (!resolvedLogPath.startsWith(baseDir + sep)) {
    return false;
  }

  if (existsSync(resolvedLogPath)) {
    try {
      const stat = lstatSync(resolvedLogPath);
      if (stat.isSymbolicLink()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function runLogsCommand(
  groupName: string | undefined,
  processName: string | undefined,
  options: LogsOptions
): void {
  try {
    if (!groupName || !processName) {
      console.error(chalk.red('Error: Please provide both group and process names'));
      printAvailableProcesses();
      process.exit(1);
      return;
    }

    let lineCount: number;
    try {
      lineCount = parseLineCount(options.lines);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
      return;
    }

    const states = StateManager.listAllStates();
    const matchingGroups = filterStatesByIdentifier(states, groupName);

    if (matchingGroups.length === 0) {
      console.error(chalk.red(`Error: Group "${groupName}" is not running`));
      printAvailableProcesses();
      process.exit(1);
      return;
    }

    const processMatches = matchingGroups.filter((state) => state.process === processName);

    if (processMatches.length === 0) {
      console.error(chalk.red(`Error: Process "${processName}" in group "${groupName}" is not running`));
      process.exit(1);
      return;
    }

    if (processMatches.length > 1) {
      console.error(
        chalk.red(
          `Error: Multiple running entries match "${groupName}/${processName}". Please use one of:\n${processMatches.map((state) => `  - ${formatStateLabel(state)}/${state.process}`).join('\n')}`
        )
      );
      process.exit(1);
      return;
    }

    const state = processMatches[0];

    if (!state?.logPath) {
      console.error(chalk.red(`Error: Log file path for process "${processName}" was not found`));
      process.exit(1);
      return;
    }

    if (!isSafeLogPath(state.logPath)) {
      console.error(chalk.red('Error: Log file path is invalid or outside the PortMux logs directory'));
      process.exit(1);
      return;
    }

    const logPath = resolve(state.logPath);

    if (!existsSync(logPath)) {
      console.error(chalk.red(`Error: Log file does not exist: ${logPath}`));
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
        console.error(chalk.red('Error: Log file was moved or deleted'));
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
            chalk.red(`Error: Failed to read log file: ${error instanceof Error ? error.message : String(error)}`)
          );
        });

        currentPosition = stats.size;
      } catch (error) {
        console.error(
          chalk.red(`Error: Failed to watch log file: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    });
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function createLogsCommand(): Command {
  return new Command('logs')
    .description('Show process logs')
    .argument('[group-name]', 'Group name')
    .argument('[process-name]', 'Process name')
    .option('-n, --lines <lines>', 'Number of trailing lines to display (default: 50)', '50')
    .option('--no-follow', 'Disable log tailing')
    .option('-t, --timestamps', 'Print timestamps before each line')
    .action((groupName: string, processName: string, cmdOptions: LogsOptions) => {
      runLogsCommand(groupName, processName, cmdOptions);
    });
}
