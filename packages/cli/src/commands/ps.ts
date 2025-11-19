import { Command } from 'commander';
import { ProcessManager } from '@portmux/core';
import chalk from 'chalk';

export const psCommand: ReturnType<typeof createPsCommand> = createPsCommand();

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
        Repository: p.groupKey ?? '-',
        Group: p.group,
        Process: p.process,
        Status: p.status,
        PID: p.pid ?? '-',
      }));

      console.table(tableData);

      // Add colored status summaries after console.table output
      processes.forEach((p) => {
        if (p.status === 'Running') {
          const pidText = p.pid !== undefined ? String(p.pid) : 'unknown';
          const repositoryLabel = p.groupKey ?? p.group;
          const repositorySuffix = p.groupKey && p.groupKey !== p.group ? ` (${p.group})` : '';
          console.log(chalk.green(`  ✓ ${repositoryLabel}${repositorySuffix}/${p.process} (PID: ${pidText})`));
        } else if (p.status === 'Error') {
          const repositoryLabel = p.groupKey ?? p.group;
          const repositorySuffix = p.groupKey && p.groupKey !== p.group ? ` (${p.group})` : '';
          console.log(chalk.red(`  ✗ ${repositoryLabel}${repositorySuffix}/${p.process}`));
        }
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
}
