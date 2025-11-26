import { closeSync, openSync, readSync, statSync, writeFileSync } from 'fs';
import { open, writeFile, type FileHandle } from 'fs/promises';
import { PortmuxError } from '../errors.js';

const DEFAULT_KEEP_RATIO = 0.8;

export class LogWriteError extends PortmuxError {
  override readonly name = 'LogWriteError';
}

export async function trimLogFile(
  logPath: string,
  maxBytes: number,
  keepRatio: number = DEFAULT_KEEP_RATIO
): Promise<void> {
  if (maxBytes <= 0) {
    throw new LogWriteError(`maxBytes must be positive. Received: ${String(maxBytes)}`);
  }

  if (keepRatio <= 0 || keepRatio >= 1) {
    throw new LogWriteError(`keepRatio must be between 0 and 1. Received: ${String(keepRatio)}`);
  }

  const keepBytes = Math.max(1, Math.floor(maxBytes * keepRatio));
  let handle: FileHandle | null = null;

  try {
    handle = await open(logPath, 'r');
  } catch {
    return;
  }

  try {
    const stats = await handle.stat();
    if (stats.size <= maxBytes) {
      return;
    }

    const bytesToKeep = Math.min(keepBytes, stats.size);
    const retained = Buffer.alloc(bytesToKeep);
    if (bytesToKeep > 0) {
      await handle.read(retained, 0, bytesToKeep, stats.size - bytesToKeep);
    }

    await writeFile(logPath, retained, { mode: 0o600 });
  } finally {
    await handle.close();
  }
}

export function trimLogFileSync(logPath: string, maxBytes: number, keepRatio: number = DEFAULT_KEEP_RATIO): void {
  if (maxBytes <= 0) {
    throw new LogWriteError(`maxBytes must be positive. Received: ${String(maxBytes)}`);
  }

  if (keepRatio <= 0 || keepRatio >= 1) {
    throw new LogWriteError(`keepRatio must be between 0 and 1. Received: ${String(keepRatio)}`);
  }

  let stats;
  try {
    stats = statSync(logPath);
  } catch {
    return;
  }

  if (stats.size <= maxBytes) {
    return;
  }

  const keepBytes = Math.max(1, Math.min(Math.floor(maxBytes * keepRatio), maxBytes));
  const bytesToKeep = Math.min(keepBytes, stats.size);
  const retained = Buffer.alloc(bytesToKeep);
  const handle = openSync(logPath, 'r');
  try {
    if (bytesToKeep > 0) {
      readSync(handle, retained, 0, bytesToKeep, stats.size - bytesToKeep);
    }
  } finally {
    closeSync(handle);
  }

  writeFileSync(logPath, retained, { mode: 0o600 });
}
