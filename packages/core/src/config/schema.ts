import { z } from 'zod';

/**
 * PortMux設定ファイルのスキーマ定義
 *
 * 最小実装では以下のフィールドのみをサポート:
 * - version: 必須
 * - runner.mode: 必須（"background"のみ）
 * - workspaces: 必須
 *   - commands: name, command は必須
 *   - ports, cwd はオプション
 *   - env は後回し（パススルーのみ）
 */

/**
 * コマンド定義のスキーマ
 */
export const CommandSchema = z.object({
  name: z.string().min(1, 'プロセス名は必須です'),
  command: z.string().min(1, 'コマンドは必須です'),
  ports: z.array(z.number().int().positive()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(), // 後回しだがパススルー用に定義
});

/**
 * ワークスペース定義のスキーマ
 */
export const WorkspaceSchema = z.object({
  description: z.string(),
  commands: z.array(CommandSchema).min(1, 'コマンドは1つ以上必要です'),
});

/**
 * Runner設定のスキーマ
 */
export const RunnerSchema = z.object({
  mode: z.literal('background', {
    errorMap: () => ({
      message: 'runner.mode は "background" のみサポートされています',
    }),
  }),
});

/**
 * PortMux設定ファイル全体のスキーマ
 */
export const PortMuxConfigSchema = z
  .object({
    version: z.string().min(1, 'version は必須です'),
    runner: RunnerSchema,
    workspaces: z.record(z.string(), WorkspaceSchema),
  })
  .refine((data) => Object.keys(data.workspaces).length > 0, {
    message: 'workspaces は1つ以上必要です',
  });

/**
 * 設定ファイルの型定義
 */
export type PortMuxConfig = z.infer<typeof PortMuxConfigSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Command = z.infer<typeof CommandSchema>;
