import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  PortInUseError,
  ProcessManager,
  ProcessRestartError,
  ProcessStartError,
  GroupManager,
  GroupResolutionError,
  type ResolvedGroup,
} from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';

export const restartCommand: ReturnType<typeof createRestartCommand> = createRestartCommand();

function resolveGroupOrFallback(groupName?: string): ResolvedGroup {
  try {
    if (groupName) {
      return GroupManager.resolveGroupByName(groupName);
    }
    return GroupManager.resolveGroupAuto();
  } catch (error) {
    if (error instanceof GroupResolutionError) {
      // フォールバック: start と同じ挙動でプロジェクト設定を直接読む
      const configPath = ConfigManager.findConfigFile();
      const config = ConfigManager.loadConfig(configPath);
      const projectRoot = resolve(configPath, '..');

      const groupKeys = Object.keys(config.groups);
      const targetGroup = groupName ?? groupKeys[0];

      if (!targetGroup) {
        throw new GroupResolutionError('No groups found');
      }

      const group = config.groups[targetGroup];
      if (!group) {
        throw new GroupResolutionError(`Group "${targetGroup}" not found`);
      }

      return {
        name: targetGroup,
        path: projectRoot,
        projectConfig: config,
        projectConfigPath: configPath,
        groupDefinitionName: targetGroup,
      };
    }
    throw error;
  }
}

async function restartProcess(resolvedGroup: ResolvedGroup, processName?: string): Promise<void> {
  const targetGroup = resolvedGroup.groupDefinitionName;
  const groupDef = resolvedGroup.projectConfig.groups[targetGroup];

  if (!groupDef) {
    console.error(chalk.red(`Error: Group "${targetGroup}" not found`));
    process.exit(1);
  }

  const processes = processName ? groupDef.commands.filter((cmd) => cmd.name === processName) : groupDef.commands;

  if (processes.length === 0) {
    console.error(
      chalk.red(processName ? `Error: Process "${processName}" not found` : 'Error: No processes to restart')
    );
    process.exit(1);
  }

  await LockManager.withLock('group', resolvedGroup.name, async () => {
    for (const cmd of processes) {
      try {
        const resolvedEnv = cmd.env ? ConfigManager.resolveEnvObject(cmd.env) : {};
        const resolvedCommand = ConfigManager.resolveCommandEnv(cmd.command, cmd.env);

        console.log(chalk.yellow(`● Restarting process "${cmd.name}"`));

        await ProcessManager.restartProcess(targetGroup, cmd.name, resolvedCommand, {
          ...(cmd.cwd !== undefined && { cwd: cmd.cwd }),
          env: resolvedEnv,
          groupKey: resolvedGroup.path,
          projectRoot: resolvedGroup.path,
          ...(cmd.ports !== undefined && { ports: cmd.ports }),
        });

        console.log(chalk.green(`✓ Restarted process "${cmd.name}"`));
      } catch (error) {
        if (
          error instanceof ProcessRestartError ||
          error instanceof ProcessStartError ||
          error instanceof PortInUseError
        ) {
          console.error(chalk.red(`Error: Failed to restart process "${cmd.name}": ${error.message}`));
        } else {
          throw error;
        }
      }
    }
  });
}

export async function runRestartCommand(groupName?: string, processName?: string): Promise<void> {
  try {
    const resolvedGroup = resolveGroupOrFallback(groupName);
    await restartProcess(resolvedGroup, processName);
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    } else if (error instanceof LockTimeoutError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    } else if (error instanceof GroupResolutionError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    } else {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }
}

function createRestartCommand(): Command {
  return new Command('restart')
    .description('Restart processes')
    .argument('[group-name]', 'Group name (defaults to resolving from the current directory)')
    .argument('[process-name]', 'Process name (targets all processes in the group when omitted)')
    .action(async (groupName?: string, processName?: string) => {
      await runRestartCommand(groupName, processName);
    });
}
