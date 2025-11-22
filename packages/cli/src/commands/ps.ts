import { Command } from 'commander';
import { ProcessManager } from '@portmux/core';
import chalk from 'chalk';

export const psCommand: ReturnType<typeof createPsCommand> = createPsCommand();

function formatRepositoryLabel(process: ReturnType<typeof ProcessManager.listProcesses>[number]): string {
  const label = process.groupLabel ?? process.repositoryName ?? process.group;
  const path = process.worktreePath ?? process.groupKey;
  if (path) {
    return `${label} (${path})`;
  }
  return label;
}

function formatGroupDisplay(process: ReturnType<typeof ProcessManager.listProcesses>[number]): string {
  return process.groupDefinitionName ?? process.groupLabel ?? process.group;
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
        Repository: formatRepositoryLabel(p),
        Group: formatGroupDisplay(p),
        Process: p.process,
        Status: p.status,
        PID: p.pid ?? '-',
      }));

      console.table(tableData);

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
