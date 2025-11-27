import { Command } from 'commander';
import { ProcessManager } from '@portmux/core';
import { chalk } from '../lib/chalk.js';
import { shortenHomePath } from '../utils/path-label.js';

export const psCommand: ReturnType<typeof createPsCommand> = createPsCommand();

interface TableRow {
  Repository: string;
  Group: string;
  Process: string;
  Status: string;
  PID: string | number;
}

function formatRepositoryLabel(
  process: ReturnType<typeof ProcessManager.listProcesses>[number],
  options?: { includePath?: boolean }
): string {
  const label = process.groupLabel ?? process.repositoryName ?? process.group;
  if (options?.includePath === false) {
    return label;
  }

  const path = process.worktreePath ?? process.groupKey;
  if (path) {
    return `${label} (${shortenHomePath(path)})`;
  }
  return label;
}

function formatGroupDisplay(process: ReturnType<typeof ProcessManager.listProcesses>[number]): string {
  return process.groupDefinitionName ?? process.groupLabel ?? process.group;
}

function renderTable(rows: TableRow[]): void {
  const headers = ['Repository', 'Group', 'Process', 'Status', 'PID'] as const;
  const columnWidths = headers.map((header) =>
    Math.max(header.length, ...rows.map((row) => String(row[header]).length))
  );
  const formatRow = (values: string[]): string =>
    `│ ${values.map((value, index) => value.padEnd(columnWidths[index] ?? 0)).join(' │ ')} │`;
  const border = (left: string, join: string, right: string): string =>
    `${left}${columnWidths.map((w) => '─'.repeat(w + 2)).join(join)}${right}`;

  console.log(border('┌', '┬', '┐'));
  console.log(formatRow(headers.map((header) => header)));
  console.log(border('├', '┼', '┤'));
  rows.forEach((row) => {
    console.log(formatRow(headers.map((header) => String(row[header]))));
  });
  console.log(border('└', '┴', '┘'));
}

function createPsCommand(): Command {
  return new Command('ps').description('Show running process states').action(() => {
    try {
      const processes = ProcessManager.listProcesses();

      if (processes.length === 0) {
        console.log(chalk.yellow('No running processes'));
        return;
      }

      // Display rows as a table
      const tableData = processes.map((p) => ({
        Repository: formatRepositoryLabel(p, { includePath: false }),
        Group: formatGroupDisplay(p),
        Process: p.process,
        Status: p.status,
        PID: p.pid ?? '-',
      }));

      renderTable(tableData);

      // Add colored status summaries after console.table output
      processes.forEach((p) => {
        if (p.status === 'Running') {
          const pidText = p.pid !== undefined ? String(p.pid) : 'unknown';
          console.log(chalk.green(`  ✓ ${formatRepositoryLabel(p)}/${p.process} (PID: ${pidText})`));
        } else if (p.status === 'Error') {
          console.log(chalk.red(`  ✗ ${formatRepositoryLabel(p)}/${p.process}`));
        }
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
}
