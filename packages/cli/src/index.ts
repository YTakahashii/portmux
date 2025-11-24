#!/usr/bin/env node

import { chalk } from './lib/chalk.js';
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import { psCommand } from './commands/ps.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { selectCommand } from './commands/select.js';
import { initCommand } from './commands/init.js';
import { restartCommand } from './commands/restart.js';
import { logsCommand } from './commands/logs.js';

const program = new Command();

program
  .name('portmux')
  .description('PortMux - Process management tool')
  .version(packageJson.version, '-v, --version', 'output the version number');

program.addCommand(initCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(restartCommand);
program.addCommand(psCommand);
program.addCommand(selectCommand);
program.addCommand(logsCommand);

// Global error handler
process.on('uncaughtException', (error) => {
  console.error(chalk.red(`Error: ${error.message}`));
  if (error.stack && process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(chalk.red(`Error: ${message}`));
  if (reason instanceof Error && reason.stack && process.env.DEBUG) {
    console.error(reason.stack);
  }
  process.exit(1);
});

program.parse();
