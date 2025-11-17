#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { psCommand } from './commands/ps.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { selectCommand } from './commands/select.js';
import { initCommand } from './commands/init.js';
import { restartCommand } from './commands/restart.js';

const program = new Command();

program.name('portmux').description('PortMux - Process management tool').version('1.0.0');

program.addCommand(initCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(restartCommand);
program.addCommand(psCommand);
program.addCommand(selectCommand);

// グローバルエラーハンドラー
process.on('uncaughtException', (error) => {
  console.error(chalk.red(`エラー: ${error.message}`));
  if (error.stack && process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(chalk.red(`エラー: ${message}`));
  if (reason instanceof Error && reason.stack && process.env.DEBUG) {
    console.error(reason.stack);
  }
  process.exit(1);
});

program.parse();
