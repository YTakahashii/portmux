import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager, ConfigNotFoundError, type Command as CommandType } from '@portmux/core';
import { ProcessManager, ProcessStartError } from '@portmux/core';
import { PortManager, PortInUseError } from '@portmux/core';
import { resolve } from 'path';

export const startCommand: ReturnType<typeof createStartCommand> = createStartCommand();

function createStartCommand(): Command {
  return new Command('start')
    .description('プロセスを起動します')
    .argument('[workspace-name]', 'ワークスペース名（省略時はカレントディレクトリから設定を読む）')
    .argument('[process-name]', 'プロセス名（省略時はワークスペースの全プロセスを起動）')
    .action(async (workspaceName?: string, processName?: string) => {
      try {
        // 設定ファイルを読み込む
        const configPath = ConfigManager.findConfigFile();
        const config = ConfigManager.loadConfig(configPath);
        const projectRoot = resolve(configPath, '..');

        // ワークスペース名が指定されていない場合は、設定ファイルから最初のワークスペースを使用
        // 最小実装では、設定ファイル内のワークスペース名をそのまま使用
        const targetWorkspace = workspaceName || Object.keys(config.workspaces)[0];

        if (!targetWorkspace) {
          console.error(chalk.red('エラー: ワークスペースが見つかりません'));
          process.exit(1);
        }

        const workspace = config.workspaces[targetWorkspace];
        if (!workspace) {
          console.error(chalk.red(`エラー: ワークスペース "${targetWorkspace}" が見つかりません`));
          process.exit(1);
        }

        // 起動するプロセスを決定
        const processesToStart = processName
          ? workspace.commands.filter((cmd: CommandType) => cmd.name === processName)
          : workspace.commands;

        if (processesToStart.length === 0) {
          console.error(
            chalk.red(
              processName
                ? `エラー: プロセス "${processName}" が見つかりません`
                : 'エラー: 起動するプロセスがありません'
            )
          );
          process.exit(1);
        }

        // 各プロセスを起動
        for (const cmd of processesToStart) {
          try {
            // ポートチェック
            if (cmd.ports && cmd.ports.length > 0) {
              try {
                await PortManager.checkPortAvailability(cmd.ports);
              } catch (error) {
                if (error instanceof PortInUseError) {
                  console.error(chalk.red(`エラー: プロセス "${cmd.name}" の起動に失敗しました: ${error.message}`));
                  continue;
                }
                throw error;
              }
            }

            // プロセスを起動
            await ProcessManager.startProcess(targetWorkspace, cmd.name, cmd.command, {
              cwd: cmd.cwd,
              env: cmd.env,
              projectRoot,
            });

            console.log(chalk.green(`✓ プロセス "${cmd.name}" を起動しました`));
          } catch (error) {
            if (error instanceof ProcessStartError) {
              console.error(chalk.red(`エラー: プロセス "${cmd.name}" の起動に失敗しました: ${error.message}`));
            } else {
              throw error;
            }
          }
        }
      } catch (error) {
        if (error instanceof ConfigNotFoundError) {
          console.error(chalk.red(`エラー: ${error.message}`));
          process.exit(1);
        } else {
          console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
      }
    });
}
