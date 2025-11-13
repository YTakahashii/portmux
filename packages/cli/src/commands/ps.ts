import { Command } from 'commander';
import { ProcessManager } from '@portmux/core';
import chalk from 'chalk';

export const psCommand: ReturnType<typeof createPsCommand> = createPsCommand();

function createPsCommand(): Command {
  return new Command('ps').description('実行中のプロセスの状態を表示します').action(() => {
    try {
      const processes = ProcessManager.listProcesses();

      if (processes.length === 0) {
        console.log(chalk.yellow('実行中のプロセスがありません'));
        return;
      }

      // テーブル形式で表示
      const tableData = processes.map((p) => ({
        Workspace: p.workspace,
        Process: p.process,
        Status: p.status,
        PID: p.pid || '-',
      }));

      console.table(tableData);

      // ステータスに色を付けて表示（console.table の後に補足表示）
      processes.forEach((p) => {
        if (p.status === 'Running') {
          console.log(chalk.green(`  ✓ ${p.workspace}/${p.process} (PID: ${p.pid})`));
        } else if (p.status === 'Error') {
          console.log(chalk.red(`  ✗ ${p.workspace}/${p.process}`));
        }
      });
    } catch (error) {
      console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
}
