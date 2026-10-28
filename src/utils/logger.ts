import { format } from 'node:util';

import { chalkStderr as chalk } from 'chalk';
import log4js from 'log4js';

/** Log4js accepts these level names; anything else falls back to INFO. */
const VALID_LOG_LEVELS = new Set([
  'ALL',
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
  'OFF',
  'MARK'
]);

const REQUESTED_LOG_LEVEL = process.env.MCP_LOG_LEVEL?.trim().toUpperCase();
const LOG_LEVEL =
  REQUESTED_LOG_LEVEL && VALID_LOG_LEVELS.has(REQUESTED_LOG_LEVEL)
    ? REQUESTED_LOG_LEVEL
    : 'INFO';

const LOGGER_CATEGORY = '@lzimul/minecraft-mcp';

/** Minimal structural type for the log4js layout event fields we use. */
interface IChalkLayoutEvent {
  readonly startTime: Date;
  readonly level: { readonly levelStr: string };
  readonly categoryName: string;
  readonly data: readonly unknown[];
}

/** Format one log line and apply the colour for its level. */
function chalkLayout(event: IChalkLayoutEvent): string {
  const line = `${event.startTime.toISOString()} [${event.level.levelStr}] ${event.categoryName} - ${format(...event.data)}`;

  switch (event.level.levelStr) {
    case 'FATAL':
    case 'ERROR':
      return chalk.red(line);
    case 'WARN':
      return chalk.yellow(line);
    case 'INFO':
      return chalk.green(line);
    case 'DEBUG':
      return chalk.cyan(line);
    case 'TRACE':
      return chalk.blue(line);
    default:
      return line;
  }
}

// All logs go to stderr; stdout is reserved for the MCP transport.
log4js.addLayout('chalk', () => chalkLayout);
log4js.configure({
  appenders: {
    stderr: {
      type: 'stderr',
      layout: { type: 'chalk' }
    }
  },
  categories: {
    default: {
      appenders: ['stderr'],
      level: LOG_LEVEL
    }
  }
});

export const logger = log4js.getLogger(LOGGER_CATEGORY);
