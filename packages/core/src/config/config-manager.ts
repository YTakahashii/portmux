import {
  type PortMuxConfig,
  PortMuxConfigSchema,
  type GlobalConfig,
  GlobalConfigSchema,
  type Repository,
} from './schema.js';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { PortmuxError } from '../errors.js';

/**
 * Error thrown when a config file cannot be found
 */
export class ConfigNotFoundError extends PortmuxError {
  override readonly name = 'ConfigNotFoundError';
  constructor(path: string) {
    super(`Config file not found: ${path}`);
  }
}

/**
 * Error thrown when a config file cannot be parsed as JSON
 */
export class ConfigParseError extends PortmuxError {
  override readonly name = 'ConfigParseError';
  constructor(path: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse config file: ${path}\n${message}`);
  }
}

/**
 * Error thrown when config data fails schema validation
 */
export class ConfigValidationError extends PortmuxError {
  override readonly name = 'ConfigValidationError';
  constructor(path: string, details: string) {
    super(`Config file validation failed: ${path}\n${details}`);
  }
}

/** Duplicate repository name error. */
export class DuplicateRepositoryNameError extends PortmuxError {
  override readonly name = 'DuplicateRepositoryNameError';
  constructor(groupName: string) {
    super(`Duplicate repository name: ${groupName}\nRepository names in the global config must be unique.`);
  }
}

/** Invalid repository reference error. */
export class InvalidRepositoryReferenceError extends PortmuxError {
  override readonly name = 'InvalidRepositoryReferenceError';
  constructor(
    public readonly groupName: string,
    public readonly referencedGroup: string,
    public readonly projectConfigPath: string
  ) {
    super(
      `Invalid repository reference.\n` +
        `The repository "${groupName}" in the global config references ` +
        `group "${referencedGroup}" in the project config, but it was not found.\n` +
        `Project config: ${projectConfigPath}`
    );
  }
}

type PortResolutionIssue = 'missing_env' | 'invalid_type' | 'invalid_value' | 'invalid_resolved';

interface PortResolutionErrorOptions {
  issue: PortResolutionIssue;
  raw?: string;
  resolved?: string;
  variable?: string;
  context?: PortResolutionContext | undefined;
}

export class PortResolutionError extends PortmuxError {
  override readonly name = 'PortResolutionError';
}

/**
 * Result of merging resolved repositories and their project configs
 */
export interface MergedRepositoryConfig {
  name: string;
  path: string;
  projectConfigPath: string;
  projectConfig: PortMuxConfig;
  groupDefinitionName: string;
}

export interface MergedGlobalConfig {
  globalConfig: GlobalConfig;
  repositories: Record<string, MergedRepositoryConfig>;
}

/**
 * Normalize paths (resolve symbolic links)
 */
function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function getHomeDirectory(): string {
  const home = process.env.HOME ?? homedir();
  try {
    return realpathSync(home);
  } catch {
    return resolve(home);
  }
}

/**
 * Expand a leading tilde to the user's home directory
 */
function expandHome(path: string): string {
  const home = getHomeDirectory();
  if (path === '~') {
    return home;
  }

  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(home, path.slice(2));
  }

  return path;
}

/**
 * Ensure repository names are unique
 */
function ensureUniqueRepositoryNames(globalConfig: GlobalConfig): void {
  const repositoryNames = new Set<string>();
  for (const name of Object.keys(globalConfig.repositories)) {
    if (repositoryNames.has(name)) {
      throw new DuplicateRepositoryNameError(name);
    }
    repositoryNames.add(name);
  }
}

/**
 * Verify that the referenced group exists in the project config
 */
function validateRepositoryReference(
  repositoryName: string,
  groupName: string,
  projectConfig: PortMuxConfig,
  projectConfigPath: string
): void {
  if (!projectConfig.groups[groupName]) {
    throw new InvalidRepositoryReferenceError(repositoryName, groupName, projectConfigPath);
  }
}

/**
 * Resolve environment variables in a string.
 * Replaces ${VAR} placeholders using process.env
 *
 * @param value String containing placeholders
 * @param commandEnv Command-level env definitions
 * @returns Resolved string
 */
function resolveEnvVariables(value: string, commandEnv: Record<string, string> = {}): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    // Priority: 1) commandEnv, 2) process.env
    const resolved = commandEnv[varName] ?? process.env[varName];

    if (resolved === undefined) {
      console.warn(`Warning: Environment variable "${varName}" is not defined. Substituting an empty string.`);
      return '';
    }

    return resolved;
  });
}

export interface PortResolutionContext {
  groupName?: string;
  commandName?: string;
}

function formatPortContext(context?: PortResolutionContext): string {
  if (!context) {
    return '';
  }

  const parts: string[] = [];
  if (context.groupName) {
    parts.push(`group "${context.groupName}"`);
  }
  if (context.commandName) {
    parts.push(`command "${context.commandName}"`);
  }

  if (parts.length === 0) {
    return '';
  }

  return ` (${parts.join(', ')})`;
}

function buildPortResolutionMessage(options: PortResolutionErrorOptions): string {
  const contextLabel = formatPortContext(options.context);
  const rawLabel = options.raw ? `"${options.raw}"` : 'value';
  const hintPrefix = 'Hint:';

  switch (options.issue) {
    case 'missing_env': {
      const variable = options.variable ?? 'UNKNOWN';
      return [
        `Port ${rawLabel} requires environment variable "${variable}", but it was not defined${contextLabel}.`,
        `${hintPrefix} Set "${variable}" in the environment or replace the port with a number.`,
      ].join('\n');
    }
    case 'invalid_resolved': {
      const resolved = options.resolved ?? '';
      return [
        `Resolved port value "${resolved}" from ${rawLabel} is not a positive integer${contextLabel}.`,
        `${hintPrefix} Ensure ${rawLabel} resolves to a positive integer.`,
      ].join('\n');
    }
    case 'invalid_value':
      return `Port value ${rawLabel} must be a positive integer or a \${VAR} placeholder${contextLabel}.`;
    case 'invalid_type':
    default:
      return `Port value must be a positive integer or a \${VAR} placeholder${contextLabel}.`;
  }
}

function createPortResolutionError(options: PortResolutionErrorOptions): PortResolutionError {
  return new PortResolutionError(buildPortResolutionMessage(options));
}

function resolvePortTemplate(
  value: string,
  commandEnv: Record<string, string>,
  context?: PortResolutionContext
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const resolved = commandEnv[varName] ?? process.env[varName];
    if (resolved === undefined) {
      throw createPortResolutionError({
        issue: 'missing_env',
        raw: value,
        variable: varName,
        context,
      });
    }
    return resolved;
  });
}

function resolvePortValue(
  value: number | string,
  commandEnv: Record<string, string>,
  context?: PortResolutionContext
): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw createPortResolutionError({
        issue: 'invalid_value',
        raw: String(value),
        context,
      });
    }
    return value;
  }

  if (typeof value !== 'string') {
    throw createPortResolutionError({ issue: 'invalid_type', context });
  }

  const raw = value.trim();
  if (raw.length === 0) {
    throw createPortResolutionError({ issue: 'invalid_value', raw, context });
  }

  const hasPlaceholder = /\$\{[^}]+\}/.test(raw);
  if (!hasPlaceholder) {
    if (!/^\d+$/.test(raw)) {
      throw createPortResolutionError({ issue: 'invalid_value', raw, context });
    }
    const numeric = Number.parseInt(raw, 10);
    if (numeric <= 0) {
      throw createPortResolutionError({ issue: 'invalid_value', raw, context });
    }
    return numeric;
  }

  const resolved = resolvePortTemplate(raw, commandEnv, context).trim();
  if (!/^\d+$/.test(resolved)) {
    throw createPortResolutionError({
      issue: 'invalid_resolved',
      raw,
      resolved,
      context,
    });
  }
  const numeric = Number.parseInt(resolved, 10);
  if (numeric <= 0) {
    throw createPortResolutionError({
      issue: 'invalid_resolved',
      raw,
      resolved,
      context,
    });
  }
  return numeric;
}

/**
 * Configuration manager
 */
export const ConfigManager = {
  /**
   * Get the global config file path
   */
  getGlobalConfigPath(): string {
    return join(homedir(), '.config', 'portmux', 'config.json');
  },

  /**
   * Walk parent directories upward from startDir to find portmux.config.json
   *
   * @param startDir Directory to start from (default: process.cwd())
   * @returns Resolved config path
   * @throws ConfigNotFoundError When the config file cannot be located
   */
  findConfigFile(startDir: string = process.cwd()): string {
    let currentDir = resolve(startDir);
    const root = resolve('/');

    while (currentDir !== root) {
      const configPath = join(currentDir, 'portmux.config.json');
      if (existsSync(configPath)) {
        return configPath;
      }
      currentDir = dirname(currentDir);
    }

    throw new ConfigNotFoundError('portmux.config.json');
  },

  /**
   * Load the global configuration file
   *
   * @returns Global config, or null if the file does not exist
   * @throws ConfigParseError When JSON parsing fails
   * @throws ConfigValidationError When schema validation fails
   */
  loadGlobalConfig(): GlobalConfig | null {
    const path = this.getGlobalConfigPath();

    // Return null when the file is missing
    if (!existsSync(path)) {
      return null;
    }

    // Read the file
    let rawContent: string;
    try {
      rawContent = readFileSync(path, 'utf-8');
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // Parse JSON
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(rawContent);
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // Validate with Zod
    const result = GlobalConfigSchema.safeParse(jsonData);
    if (!result.success) {
      const details = result.error.issues.map((err) => `${err.path.map(String).join('.')}: ${err.message}`).join('\n');
      throw new ConfigValidationError(path, details);
    }

    return result.data;
  },

  /**
   * Load and validate a project configuration file
   *
   * @param configPath Path to the config (auto-detected when omitted)
   * @returns Validated configuration object
   * @throws ConfigNotFoundError When the file does not exist
   * @throws ConfigParseError When JSON parsing fails
   * @throws ConfigValidationError When schema validation fails
   */
  loadConfig(configPath?: string): PortMuxConfig {
    const path = configPath ?? this.findConfigFile();

    // Verify the file exists
    if (!existsSync(path)) {
      throw new ConfigNotFoundError(path);
    }

    // Read file contents
    let rawContent: string;
    try {
      rawContent = readFileSync(path, 'utf-8');
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // Parse JSON
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(rawContent);
    } catch (error) {
      throw new ConfigParseError(path, error);
    }

    // Validate with Zod
    const result = PortMuxConfigSchema.safeParse(jsonData);
    if (!result.success) {
      const details = result.error.issues.map((err) => `${err.path.map(String).join('.')}: ${err.message}`).join('\n');
      throw new ConfigValidationError(path, details);
    }

    return result.data;
  },

  /**
   * Validate consistency between global and project configurations.
   *
   * @param globalConfig Global configuration
   * @param projectConfig Project configuration
   * @param projectConfigPath Path to the project configuration (used in error messages)
   * @throws DuplicateRepositoryNameError When repository names are duplicated
   * @throws InvalidRepositoryReferenceError When a repository points to a missing group definition
   */
  validateGlobalConfig(globalConfig: GlobalConfig, projectConfig: PortMuxConfig, projectConfigPath: string): void {
    ensureUniqueRepositoryNames(globalConfig);

    const normalizedProjectConfigPath = normalizePath(expandHome(projectConfigPath));

    // Verify external references only for repositories that point to the provided project config
    for (const [repositoryName, repository] of Object.entries(globalConfig.repositories)) {
      const repositoryRoot = expandHome(repository.path);
      const repositoryConfigPath = normalizePath(join(repositoryRoot, 'portmux.config.json'));
      if (repositoryConfigPath !== normalizedProjectConfigPath) {
        continue;
      }

      validateRepositoryReference(repositoryName, repository.group, projectConfig, projectConfigPath);
    }
  },

  /**
   * Merge global and project configurations
   *
   * - When targetRepository is provided, merge only that entry
   * - When skipInvalid is true, skip repositories with missing configs or group references
   *
   * @returns Merged settings, or null when the global config file is missing
   */
  mergeGlobalAndProjectConfigs(options?: {
    targetRepository?: string;
    skipInvalid?: boolean;
  }): MergedGlobalConfig | null {
    const globalConfig = this.loadGlobalConfig();
    if (!globalConfig) {
      return null;
    }

    ensureUniqueRepositoryNames(globalConfig);

    if (options?.targetRepository && !globalConfig.repositories[options.targetRepository]) {
      return { globalConfig, repositories: {} };
    }

    const repositoriesToProcess: Record<string, Repository> = {};
    if (options?.targetRepository) {
      const targetRepo = globalConfig.repositories[options.targetRepository];
      if (targetRepo) {
        repositoriesToProcess[options.targetRepository] = targetRepo;
      }
    } else {
      Object.assign(repositoriesToProcess, globalConfig.repositories);
    }

    const mergedRepositories: Record<string, MergedRepositoryConfig> = {};
    const skipInvalid = options?.skipInvalid ?? false;

    for (const [repositoryName, repository] of Object.entries(repositoriesToProcess)) {
      const projectRoot = expandHome(repository.path);
      const projectConfigPath = join(projectRoot, 'portmux.config.json');

      try {
        if (!existsSync(projectConfigPath)) {
          throw new ConfigNotFoundError(projectConfigPath);
        }

        const projectConfig = this.loadConfig(projectConfigPath);
        validateRepositoryReference(repositoryName, repository.group, projectConfig, projectConfigPath);

        mergedRepositories[repositoryName] = {
          name: repositoryName,
          path: normalizePath(projectRoot),
          projectConfig,
          projectConfigPath,
          groupDefinitionName: repository.group,
        };
      } catch (error) {
        if (!skipInvalid) {
          throw error;
        }
        console.warn(
          `Warning: Failed to merge configuration for repository "${repositoryName}". ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return { globalConfig, repositories: mergedRepositories };
  },

  /**
   * Resolve environment variables inside a command string
   *
   * @param command Command string
   * @param commandEnv Env definitions within the command
   * @returns Resolved command string
   */
  resolveCommandEnv(command: string, commandEnv: Record<string, string> = {}): string {
    return resolveEnvVariables(command, commandEnv);
  },

  /**
   * Resolve command ports from numbers or env placeholders.
   *
   * @param ports Ports defined in the config
   * @param commandEnv Env definitions within the command
   * @param context Optional context for error messages
   * @returns Fully resolved port list
   */
  resolveCommandPorts(
    ports: (number | string)[] | undefined,
    commandEnv: Record<string, string> = {},
    context?: PortResolutionContext
  ): number[] | undefined {
    if (!ports) {
      return undefined;
    }

    return ports.map((port) => resolvePortValue(port, commandEnv, context));
  },

  /**
   * Resolve environment variable objects recursively
   * When a value contains ${VAR}, replace it with the corresponding value
   *
   * @param commandEnv Env definitions within the command
   * @returns Fully resolved env object
   */
  resolveEnvObject(commandEnv: Record<string, string> = {}): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(commandEnv)) {
      resolved[key] = resolveEnvVariables(value, commandEnv);
    }

    return resolved;
  },
};
