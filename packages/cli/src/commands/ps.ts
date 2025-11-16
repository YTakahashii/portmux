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
        Repository: p.workspaceKey ?? '-',
        Workspace: p.workspace,
        Process: p.process,
        Status: p.status,
        PID: p.pid ?? '-',
      }));

      console.table(tableData);

      // ステータスに色を付けて表示（console.table の後に補足表示）
      processes.forEach((p) => {
        if (p.status === 'Running') {
          const pidText = p.pid !== undefined ? String(p.pid) : 'unknown';
          const repositoryLabel = p.workspaceKey ?? p.workspace;
          const repositorySuffix = p.workspaceKey && p.workspaceKey !== p.workspace ? ` (${p.workspace})` : '';
          console.log(chalk.green(`  ✓ ${repositoryLabel}${repositorySuffix}/${p.process} (PID: ${pidText})`));
        } else if (p.status === 'Error') {
          const repositoryLabel = p.workspaceKey ?? p.workspace;
          const repositorySuffix = p.workspaceKey && p.workspaceKey !== p.workspace ? ` (${p.workspace})` : '';
          console.log(chalk.red(`  ✗ ${repositoryLabel}${repositorySuffix}/${p.process}`));
        }
      });
    } catch (error) {
      console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
}
