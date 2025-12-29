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
  StateManager,
  type ResolvedGroup,
} from '@portmux/core';
import { Command } from 'commander';
import { chalk } from '../lib/chalk.js';
import { resolve } from 'path';
import { buildGroupInstanceId, buildGroupLabel } from '../utils/group-instance.js';

export const restartCommand: ReturnType<typeof createRestartCommand> = createRestartCommand();
interface RestartInvokeOptions {
  restartAll?: boolean;
}

function resolveGroupOrFallback(groupName?: string): ResolvedGroup {
  try {
    if (groupName) {
      return GroupManager.resolveGroupByName(groupName);
    }
    return GroupManager.resolveGroupAuto();
  } catch (error) {
    if (error instanceof GroupResolutionError) {
      // Fallback: read the project config directly just like the start command
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
        logsDisabled: false,
      };
    }
    throw error;
  }
}

function normalizePath(pathStr?: string): string | null {
  if (!pathStr) {
    return null;
  }

  try {
    return resolve(pathStr);
  } catch {
    return pathStr;
  }
}

async function restartProcessesForGroup(
  resolvedGroup: ResolvedGroup,
  targetGroup: string,
  processNames?: Set<string>
): Promise<void> {
  const groupDef = resolvedGroup.projectConfig.groups[targetGroup];

  if (!groupDef) {
    console.error(chalk.red(`Error: Group "${targetGroup}" not found`));
    process.exit(1);
  }

  const processes = processNames ? groupDef.commands.filter((cmd) => processNames.has(cmd.name)) : groupDef.commands;
  const logMaxBytes = resolvedGroup.logMaxBytes;
  const disableLogs = resolvedGroup.logsDisabled === true;

  if (processes.length === 0) {
    const label = processNames?.size === 1 ? Array.from(processNames)[0] : undefined;
    console.error(chalk.red(label ? `Error: Process "${label}" not found` : 'Error: No processes to restart'));
    process.exit(1);
  }

  const groupInstanceId = buildGroupInstanceId(resolvedGroup.name, targetGroup, resolvedGroup.path);
  const groupLabel = buildGroupLabel(resolvedGroup.name);

  await LockManager.withLock('group', groupInstanceId, async () => {
    for (const cmd of processes) {
      try {
        const resolvedEnv = cmd.env ? ConfigManager.resolveEnvObject(cmd.env) : {};
        const resolvedCommand = ConfigManager.resolveCommandEnv(cmd.command, cmd.env);
        const resolvedPorts = ConfigManager.resolveCommandPorts(cmd.ports, cmd.env ?? {}, {
          groupName: targetGroup,
          commandName: cmd.name,
        });

        console.log(chalk.yellow(`● Restarting process "${cmd.name}"`));

        await ProcessManager.restartProcess(groupInstanceId, cmd.name, resolvedCommand, {
          ...(cmd.cwd !== undefined && { cwd: cmd.cwd }),
          env: resolvedEnv,
          groupKey: resolvedGroup.path,
          projectRoot: resolvedGroup.path,
          groupLabel,
          repositoryName: resolvedGroup.name,
          groupDefinitionName: targetGroup,
          worktreePath: resolvedGroup.path,
          ...(resolvedPorts !== undefined && { ports: resolvedPorts }),
          ...(logMaxBytes !== undefined && { logMaxBytes }),
          ...(disableLogs && { disableLogs }),
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

export async function runRestartCommand(
  groupName?: string,
  processName?: string,
  options?: RestartInvokeOptions
): Promise<void> {
  try {
    const resolvedGroup = resolveGroupOrFallback(groupName);

    if (options?.restartAll && processName) {
      console.error(chalk.red('Error: --all cannot be combined with a process name'));
      process.exit(1);
    }

    if (options?.restartAll) {
      const currentPath = normalizePath(resolvedGroup.path);
      const running = StateManager.listAllStates().filter((state) => {
        if (state.status !== 'Running') {
          return false;
        }
        if (state.repositoryName !== resolvedGroup.name) {
          return false;
        }
        const statePath = normalizePath(state.worktreePath ?? state.groupKey);
        if (currentPath && statePath && currentPath !== statePath) {
          return false;
        }
        return true;
      });

      if (running.length === 0) {
        console.log(chalk.yellow('No running processes to restart.'));
        return;
      }

      const processesByGroup = new Map<string, Set<string>>();
      for (const state of running) {
        const groupDefinition = state.groupDefinitionName ?? resolvedGroup.groupDefinitionName;
        if (!groupDefinition) {
          continue;
        }
        const processSet = processesByGroup.get(groupDefinition) ?? new Set<string>();
        processSet.add(state.process);
        processesByGroup.set(groupDefinition, processSet);
      }

      for (const [groupDefinitionName, processNames] of processesByGroup.entries()) {
        if (!resolvedGroup.projectConfig.groups[groupDefinitionName]) {
          console.log(
            chalk.yellow(
              `Group "${groupDefinitionName}" is not defined in the project config. Skipping restart for this group.`
            )
          );
          continue;
        }
        await restartProcessesForGroup(resolvedGroup, groupDefinitionName, processNames);
      }
      return;
    }

    await restartProcessesForGroup(
      resolvedGroup,
      resolvedGroup.groupDefinitionName,
      processName ? new Set([processName]) : undefined
    );
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
    .option('--all', 'Restart all running processes in the current project')
    .action(async (groupName?: string, processName?: string, options?: { all?: boolean }) => {
      await runRestartCommand(groupName, processName, { restartAll: options?.all === true });
    });
}
