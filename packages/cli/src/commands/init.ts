import {
  ConfigManager,
  GlobalConfigSchema,
  PortMuxConfigSchema,
  type GlobalConfig,
  type PortMuxConfig,
  type Group,
} from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import inquirer from 'inquirer';
import { dirname, resolve } from 'path';

interface InitOptions {
  force?: boolean;
}

interface GroupAnswers {
  groupName: string;
  description: string;
}

interface CommandAnswers {
  name: string;
  command: string;
  ports: string;
  cwd: string;
}

export const initCommand: ReturnType<typeof createInitCommand> = createInitCommand();

function isInsideGitRepository(): boolean {
  try {
    const output = execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function parsePorts(ports: string): number[] | null {
  if (!ports.trim()) {
    return [];
  }

  const parts = ports
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  return parts.map((part) => Number.parseInt(part, 10));
}

function formatValidationErrors(errors: string[], header: string): void {
  console.error(chalk.red(header));
  for (const error of errors) {
    console.error(chalk.red(`- ${error}`));
  }
}

async function promptGroupDefinition(): Promise<GroupAnswers> {
  return inquirer.prompt<GroupAnswers>([
    {
      type: 'input',
      name: 'groupName',
      message: 'Enter a group name',
      default: 'default',
      validate: (input: string) => input.trim() !== '' || 'Group name is required',
    },
    {
      type: 'input',
      name: 'description',
      message: 'Enter a group description (optional)',
      default: '',
    },
  ]);
}

async function promptCommandDefinition(): Promise<CommandAnswers> {
  return inquirer.prompt<CommandAnswers>([
    {
      type: 'input',
      name: 'name',
      message: 'Enter a process name',
      validate: (input: string) => input.trim() !== '' || 'Process name is required',
    },
    {
      type: 'input',
      name: 'command',
      message: 'Enter the command to run',
      validate: (input: string) => input.trim() !== '' || 'Command is required',
    },
    {
      type: 'input',
      name: 'ports',
      message: 'Enter comma-separated port numbers (e.g., 3000,3001)',
      default: '',
      validate: (input: string) => parsePorts(input) !== null || 'Ports must be numeric values separated by commas',
    },
    {
      type: 'input',
      name: 'cwd',
      message: 'Enter the command cwd (defaults to the project root)',
      default: '',
    },
  ]);
}

async function promptEnvVariables(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  for (;;) {
    const { addEnv } = await inquirer.prompt<{ addEnv: boolean }>([
      {
        type: 'confirm',
        name: 'addEnv',
        message: 'Add an environment variable?',
        default: false,
      },
    ]);

    if (!addEnv) {
      break;
    }

    const envAnswer = await inquirer.prompt<{ key: string; value: string }>([
      {
        type: 'input',
        name: 'key',
        message: 'Enter the environment variable name',
        validate: (input: string) => input.trim() !== '' || 'Environment variable name is required',
      },
      {
        type: 'input',
        name: 'value',
        message: 'Enter the environment variable value',
        default: '',
      },
    ]);

    env[envAnswer.key.trim()] = envAnswer.value;
  }

  return env;
}

async function buildGroupConfig(): Promise<{ name: string; group: Group }> {
  const groupAnswers = await promptGroupDefinition();
  const commands: Group['commands'] = [];

  for (;;) {
    const commandAnswers = await promptCommandDefinition();
    const env = await promptEnvVariables();
    const ports = parsePorts(commandAnswers.ports);

    const commandConfig: Group['commands'][number] = {
      name: commandAnswers.name.trim(),
      command: commandAnswers.command.trim(),
    };

    if (ports && ports.length > 0) {
      commandConfig.ports = ports;
    }

    if (commandAnswers.cwd.trim()) {
      commandConfig.cwd = commandAnswers.cwd.trim();
    }

    if (Object.keys(env).length > 0) {
      commandConfig.env = env;
    }

    commands.push(commandConfig);

    const { addMore } = await inquirer.prompt<{ addMore: boolean }>([
      {
        type: 'confirm',
        name: 'addMore',
        message: 'Add another process?',
        default: false,
      },
    ]);

    if (!addMore) {
      break;
    }
  }

  const group: Group = {
    description: groupAnswers.description,
    commands,
  };

  return { name: groupAnswers.groupName.trim(), group };
}

async function confirmOverwrite(path: string, force?: boolean): Promise<boolean> {
  if (!existsSync(path)) {
    return true;
  }

  if (force) {
    return true;
  }

  const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
    {
      type: 'confirm',
      name: 'overwrite',
      message: `${path} already exists. Overwrite it?`,
      default: false,
    },
  ]);

  return overwrite;
}

export async function runInitCommand(options: InitOptions): Promise<void> {
  const projectConfigPath = resolve(process.cwd(), 'portmux.config.json');
  const globalConfigPath = ConfigManager.getGlobalConfigPath();
  const projectRoot = resolve(process.cwd());
  const localSchemaPath = 'node_modules/@portmux/cli/schemas/portmux.config.schema.json';

  try {
    if (!isInsideGitRepository()) {
      console.warn(chalk.yellow('Warning: Running outside a Git repository. Please use absolute paths.'));
    }

    const projectWritable = await confirmOverwrite(projectConfigPath, options.force);
    if (!projectWritable) {
      console.log(chalk.yellow('Skipped generating the project config.'));
      return;
    }

    const { name: groupName, group } = await buildGroupConfig();
    const projectConfig: PortMuxConfig = {
      $schema: localSchemaPath,
      groups: {
        [groupName]: group,
      },
    };

    const projectValidation = PortMuxConfigSchema.safeParse(projectConfig);
    if (!projectValidation.success) {
      const details = projectValidation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      formatValidationErrors(details, 'Project config validation failed. Please fix the issues.');
      process.exit(1);
    }

    writeJsonFile(projectConfigPath, projectConfig);
    console.log(chalk.green(`✓ Generated project config: ${projectConfigPath}`));

    const globalRepository = {
      globalName: groupName,
      projectPath: projectRoot,
      groupRef: groupName,
    };

    let globalConfig: GlobalConfig = {
      repositories: {},
    };
    let hasExistingGlobal = false;

    try {
      const loaded = ConfigManager.loadGlobalConfig();
      if (loaded) {
        globalConfig = loaded;
        hasExistingGlobal = true;
      }
    } catch (error) {
      console.error(
        chalk.red(`Failed to load existing global config: ${error instanceof Error ? error.message : String(error)}`)
      );
      process.exit(1);
    }

    if (hasExistingGlobal && globalConfig.repositories[globalRepository.globalName] && !options.force) {
      console.log(
        chalk.yellow(
          `Skipped adding "${globalRepository.globalName}" because it already exists. Use --force to overwrite.`
        )
      );
      return;
    }

    globalConfig.repositories[globalRepository.globalName] = {
      path: globalRepository.projectPath,
      group: globalRepository.groupRef,
    };

    const globalValidation = GlobalConfigSchema.safeParse(globalConfig);
    if (!globalValidation.success) {
      const details = globalValidation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      formatValidationErrors(details, 'Global config validation failed. Please fix the issues.');
      process.exit(1);
    }

    ConfigManager.validateGlobalConfig(globalConfig, projectConfig, projectConfigPath);
    writeJsonFile(globalConfigPath, globalConfig);
    console.log(chalk.green(`✓ Updated global config: ${globalConfigPath}`));
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function createInitCommand(): Command {
  return new Command('init')
    .description('Generate PortMux config files')
    .option('--force', 'Overwrite existing config files')
    .action(async (options: InitOptions) => {
      await runInitCommand(options);
    });
}
