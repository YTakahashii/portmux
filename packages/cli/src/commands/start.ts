import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  PortInUseError,
  ProcessManager,
  ProcessStartError,
  GroupManager,
  GroupResolutionError,
  type ResolvedGroup,
} from '@portmux/core';

import { Command } from 'commander';
import { chalk } from '../lib/chalk.js';
import { resolve } from 'path';
import { buildGroupInstanceId, buildGroupLabel } from '../utils/group-instance.js';

interface StartInvokeOptions {
  worktreePath?: string;
  worktreeLabel?: string;
}

function extractCauseMessage(cause: unknown): string | undefined {
  if (!cause) {
    return undefined;
  }

  if (cause instanceof Error && typeof cause.message === 'string' && cause.message.length > 0) {
    return cause.message;
  }

  if (typeof cause === 'string' && cause.length > 0) {
    return cause;
  }

  return undefined;
}

function extractCauseStack(cause: unknown): string | undefined {
  if (!cause) {
    return undefined;
  }

  if (cause instanceof Error && typeof cause.stack === 'string' && cause.stack.length > 0) {
    return cause.stack;
  }

  return undefined;
}

function formatStartErrorMessage(
  error: Error | { message: string; cause?: unknown }
): { message: string; causeStack?: string } {
  const message = 'message' in error && typeof error.message === 'string' ? error.message : String(error);
  const causeMessage = extractCauseMessage('cause' in error ? error.cause : undefined);
  const causeStack = extractCauseStack('cause' in error ? error.cause : undefined);

  const base = causeStack ? { causeStack } : {};

  if (causeMessage && causeMessage !== message) {
    return { message: `${message} (Original error: ${causeMessage})`, ...base };
  }

  return { message, ...base };
}

export const startCommand: ReturnType<typeof createStartCommand> = createStartCommand();

export async function runStartCommand(
  groupName?: string,
  processName?: string,
  invokeOptions?: StartInvokeOptions
): Promise<void> {
  try {
    // Resolve the target group
    let resolvedGroup: ResolvedGroup;
    try {
      if (groupName) {
        // When a group name is provided, look it up from the global config
        const resolutionOptions =
          invokeOptions?.worktreePath !== undefined ? { worktreePath: invokeOptions.worktreePath } : undefined;
        resolvedGroup = GroupManager.resolveGroupByName(groupName, resolutionOptions);
      } else {
        // Otherwise resolve automatically
        resolvedGroup = GroupManager.resolveGroupAuto();
      }
    } catch (error) {
      if (error instanceof GroupResolutionError) {
        // Fall back to the legacy approach when GroupManager resolution fails
        const configPath = ConfigManager.findConfigFile();
        const config = ConfigManager.loadConfig(configPath);
        const projectRoot = resolve(configPath, '..');

        const groupKeys = Object.keys(config.groups);
        const targetGroup = groupName ?? groupKeys[0];

        if (!targetGroup) {
          console.error(chalk.red('Error: No groups found'));
          process.exit(1);
        }

        const group = config.groups[targetGroup];
        if (!group) {
          console.error(chalk.red(`Error: Group "${targetGroup}" not found`));
          process.exit(1);
        }

        resolvedGroup = {
          name: targetGroup,
          path: projectRoot,
          projectConfig: config,
          projectConfigPath: configPath,
          groupDefinitionName: targetGroup,
        };
      } else {
        throw error;
      }
    }

    const targetGroup = resolvedGroup.groupDefinitionName;
    const group = resolvedGroup.projectConfig.groups[targetGroup];
    const projectRoot = resolvedGroup.path;

    if (!group) {
      console.error(chalk.red(`Error: Group "${targetGroup}" not found`));
      process.exit(1);
    }

    const groupInstanceId = buildGroupInstanceId(resolvedGroup.name, targetGroup, projectRoot);
    const groupLabel = buildGroupLabel(resolvedGroup.name, invokeOptions?.worktreeLabel);

    // Determine which processes should be started
    const processesToStart = processName ? group.commands.filter((cmd) => cmd.name === processName) : group.commands;

    if (processesToStart.length === 0) {
      console.error(
        chalk.red(processName ? `Error: Process "${processName}" not found` : 'Error: No processes to start')
      );
      process.exit(1);
    }

    // Acquire a lock and start each process
    await LockManager.withLock('group', groupInstanceId, async () => {
      for (const cmd of processesToStart) {
        try {
          // Resolve environment variables
          const resolvedEnv = cmd.env ? ConfigManager.resolveEnvObject(cmd.env) : {};
          const resolvedCommand = ConfigManager.resolveCommandEnv(cmd.command, cmd.env);

          // Start the process (ProcessManager uses PortManager reservation APIs internally)
          await ProcessManager.startProcess(groupInstanceId, cmd.name, resolvedCommand, {
            ...(cmd.cwd !== undefined && { cwd: cmd.cwd }),
            env: resolvedEnv,
            projectRoot,
            groupKey: projectRoot,
            groupLabel,
            repositoryName: resolvedGroup.name,
            groupDefinitionName: targetGroup,
            worktreePath: projectRoot,
            ...(invokeOptions?.worktreeLabel !== undefined && { branch: invokeOptions.worktreeLabel }),
            ...(cmd.ports !== undefined && { ports: cmd.ports }),
          });

          console.log(chalk.green(`✓ Started process "${cmd.name}"`));
        } catch (error) {
          if (error instanceof ProcessStartError || error instanceof PortInUseError) {
            const { message: detailedMessage, causeStack } = formatStartErrorMessage(error);
            const lines = [`Error: Failed to start process "${cmd.name}": ${detailedMessage}`];
            if (causeStack) {
              lines.push(`Caused by:\n${causeStack}`);
            }
            console.error(chalk.red(lines.join('\n')));
          } else {
            throw error;
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    } else if (error instanceof LockTimeoutError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    } else {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }
}

function createStartCommand(): Command {
  return new Command('start')
    .description('Start processes')
    .argument('[group-name]', 'Group name (defaults to resolving from the current directory)')
    .argument('[process-name]', 'Process name (starts all processes in the group when omitted)')
    .action(async (groupName?: string, processName?: string) => {
      await runStartCommand(groupName, processName);
    });
}
