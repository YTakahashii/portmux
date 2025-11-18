import { z } from 'zod';

/**
 * Schema definitions for PortMux configuration files.
 *
 * Minimal support includes:
 * - version: required
 * - runner.mode: required ("background" only)
 * - workspaces: required
 *   - commands: name and command are required
 *   - ports and cwd are optional
 *   - env is currently passthrough only
 */

/**
 * Command definition schema.
 */
export const CommandSchema = z.object({
  name: z.string().min(1, 'プロセス名は必須です'),
  command: z.string().min(1, 'コマンドは必須です'),
  ports: z.array(z.number().int().positive()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(), // 後回しだがパススルー用に定義
});

/** Workspace definition schema. */
export const WorkspaceSchema = z.object({
  description: z.string(),
  commands: z.array(CommandSchema).min(1, 'コマンドは1つ以上必要です'),
});

/**
 * Runner schema.
 */
export const RunnerSchema = z.object({
  mode: z.literal('background'),
});

/**
 * Project-level PortMux configuration schema.
 */
export const PortMuxConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.string().min(1, 'version は必須です'),
    runner: RunnerSchema,
    workspaces: z.record(z.string(), WorkspaceSchema),
  })
  .refine((data) => Object.keys(data.workspaces).length > 0, {
    message: 'workspaces は1つ以上必要です',
  });

/**
 * Repository reference schema for the global configuration.
 */
export const RepositorySchema = z.object({
  path: z.string().min(1, 'path は必須です'),
  workspace: z.string().min(1, 'workspace は必須です'),
});

/**
 * Global configuration schema.
 */
export const GlobalConfigSchema = z.object({
  version: z.string().min(1, 'version は必須です'),
  repositories: z.record(z.string(), RepositorySchema),
});

/**
 * Type definitions for configuration files.
 */
export type PortMuxConfig = z.infer<typeof PortMuxConfigSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type Repository = z.infer<typeof RepositorySchema>;
