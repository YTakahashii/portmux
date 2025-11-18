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
      message: 'グループ名を入力してください',
      default: 'default',
      validate: (input: string) => input.trim() !== '' || 'グループ名は必須です',
    },
    {
      type: 'input',
      name: 'description',
      message: 'グループの説明を入力してください（任意）',
      default: '',
    },
  ]);
}

async function promptCommandDefinition(): Promise<CommandAnswers> {
  return inquirer.prompt<CommandAnswers>([
    {
      type: 'input',
      name: 'name',
      message: 'プロセス名を入力してください',
      validate: (input: string) => input.trim() !== '' || 'プロセス名は必須です',
    },
    {
      type: 'input',
      name: 'command',
      message: '実行するコマンドを入力してください',
      validate: (input: string) => input.trim() !== '' || 'コマンドは必須です',
    },
    {
      type: 'input',
      name: 'ports',
      message: '使用するポート番号をカンマ区切りで入力してください（例: 3000,3001）',
      default: '',
      validate: (input: string) => parsePorts(input) !== null || 'ポート番号は数値をカンマ区切りで入力してください',
    },
    {
      type: 'input',
      name: 'cwd',
      message: 'コマンドのcwdを入力してください（未指定の場合はプロジェクトルート）',
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
        message: '環境変数を追加しますか？',
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
        message: '環境変数名を入力してください',
        validate: (input: string) => input.trim() !== '' || '環境変数名は必須です',
      },
      {
        type: 'input',
        name: 'value',
        message: '環境変数の値を入力してください',
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
        message: '別のプロセスを追加しますか？',
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
      message: `${path} は既に存在します。上書きしますか？`,
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
      console.warn(chalk.yellow('警告: Git リポジトリ外で実行されています。パスは絶対パスで指定してください。'));
    }

    const projectWritable = await confirmOverwrite(projectConfigPath, options.force);
    if (!projectWritable) {
      console.log(chalk.yellow('プロジェクト設定の生成をスキップしました。'));
      return;
    }

    const { name: groupName, group } = await buildGroupConfig();
    const projectConfig: PortMuxConfig = {
      $schema: localSchemaPath,
      version: '1.0.0',
      groups: {
        [groupName]: group,
      },
    };

    const projectValidation = PortMuxConfigSchema.safeParse(projectConfig);
    if (!projectValidation.success) {
      const details = projectValidation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      formatValidationErrors(details, 'プロジェクト設定のバリデーションに失敗しました。修正してください。');
      process.exit(1);
    }

    writeJsonFile(projectConfigPath, projectConfig);
    console.log(chalk.green(`✓ プロジェクト設定を生成しました: ${projectConfigPath}`));

    const globalRepository = {
      globalName: groupName,
      projectPath: projectRoot,
      groupRef: groupName,
    };

    let globalConfig: GlobalConfig = {
      version: '1.0.0',
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
        chalk.red(
          `既存のグローバル設定を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }

    if (hasExistingGlobal && globalConfig.repositories[globalRepository.globalName] && !options.force) {
      console.log(
        chalk.yellow(
          `グローバル設定に "${globalRepository.globalName}" が既に存在するため追加をスキップしました。--force で上書きできます。`
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
      formatValidationErrors(details, 'グローバル設定のバリデーションに失敗しました。修正してください。');
      process.exit(1);
    }

    ConfigManager.validateGlobalConfig(globalConfig, projectConfig, projectConfigPath);
    writeJsonFile(globalConfigPath, globalConfig);
    console.log(chalk.green(`✓ グローバル設定を更新しました: ${globalConfigPath}`));
  } catch (error) {
    console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function createInitCommand(): Command {
  return new Command('init')
    .description('PortMux の設定ファイルを生成します')
    .option('--force', '既存の設定ファイルを上書きします')
    .action(async (options: InitOptions) => {
      await runInitCommand(options);
    });
}
