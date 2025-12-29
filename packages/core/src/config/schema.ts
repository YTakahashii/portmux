import { z } from 'zod';

/**
 * Schema definitions for PortMux configuration files.
 *
 * Minimal support includes:
 * - groups: required
 *   - commands: name and command are required
 *   - ports and cwd are optional
 *   - env is currently passthrough only
 */

/**
 * Command definition schema.
 */
export const CommandSchema = z.object({
  name: z.string().min(1, 'Process name is required'),
  command: z.string().min(1, 'Command is required'),
  ports: z.array(z.union([z.number().int().positive(), z.string().min(1)])).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(), // Placeholder for passthrough support handled later
});

/** Group definition schema. */
export const GroupSchema = z.object({
  description: z.string(),
  commands: z.array(CommandSchema).min(1, 'At least one command is required'),
});

/**
 * Runner schema.
 */
export const RunnerSchema = z.object({
  mode: z.literal('background'),
});

/** Logs configuration schema. */
/** Global logs configuration schema. */
export const GlobalLogsConfigSchema = z.object({
  maxBytes: z.number().int().positive().optional(),
  disabled: z.boolean().optional(),
});

/**
 * Project-level PortMux configuration schema.
 */
export const PortMuxConfigSchema = z
  .object({
    $schema: z.string().optional(),
    runner: RunnerSchema.optional(),
    groups: z.record(z.string(), GroupSchema),
  })
  .refine((data) => Object.keys(data.groups).length > 0, {
    message: 'At least one group is required',
  });

/**
 * Repository reference schema for the global configuration.
 */
export const RepositorySchema = z.object({
  path: z.string().min(1, 'path is required'),
  group: z.string().min(1, 'group is required'),
});

/**
 * Global configuration schema.
 */
export const GlobalConfigSchema = z.object({
  logs: GlobalLogsConfigSchema.optional(),
  repositories: z.record(z.string(), RepositorySchema),
});

/**
 * Type definitions for configuration files.
 */
export type PortMuxConfig = z.infer<typeof PortMuxConfigSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type GlobalLogsConfig = z.infer<typeof GlobalLogsConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type Repository = z.infer<typeof RepositorySchema>;
