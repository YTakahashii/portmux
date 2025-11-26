import { createWriteStream, type WriteStream } from 'fs';
import { open, stat, writeFile, type FileHandle } from 'fs/promises';
import { PortmuxError } from '../errors.js';

const DEFAULT_KEEP_RATIO = 0.8;

export class LogWriteError extends PortmuxError {
  override readonly name = 'LogWriteError';
}

export class LogWriter {
  private constructor(
    private readonly logPath: string,
    private readonly maxBytes: number,
    private readonly keepBytes: number,
    private writeStream: WriteStream,
    private currentSize: number,
    private pending: Promise<void>
  ) {}

  static async create(logPath: string, maxBytes: number, keepRatio: number = DEFAULT_KEEP_RATIO): Promise<LogWriter> {
    if (maxBytes <= 0) {
      throw new LogWriteError(`maxBytes must be positive. Received: ${String(maxBytes)}`);
    }

    if (keepRatio <= 0 || keepRatio >= 1) {
      throw new LogWriteError(`keepRatio must be between 0 and 1. Received: ${String(keepRatio)}`);
    }

    const keepBytes = Math.max(1, Math.floor(maxBytes * keepRatio));
    const existingSize = await LogWriter.getFileSize(logPath);
    const writeStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });

    return new LogWriter(logPath, maxBytes, keepBytes, writeStream, existingSize, Promise.resolve());
  }

  private static async getFileSize(path: string): Promise<number> {
    try {
      const stats = await stat(path);
      return stats.size;
    } catch {
      return 0;
    }
  }

  async write(chunk: Buffer | string): Promise<void> {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.pending = this.pending.catch(() => undefined).then(() => this.appendAndTrim(data));
    return this.pending;
  }

  async close(): Promise<void> {
    this.pending = this.pending.catch(() => undefined).then(() => this.closeStream());
    return this.pending;
  }

  private async appendAndTrim(data: Buffer): Promise<void> {
    await this.writeToStream(data);
    this.currentSize += data.length;

    if (this.currentSize > this.maxBytes) {
      await this.trim();
    }
  }

  private async closeStream(): Promise<void> {
    if (this.writeStream.closed) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.writeStream.end((error: NodeJS.ErrnoException | null) => {
        if (error) {
          reject(new LogWriteError(`Failed to close log file: ${this.logPath}`, error));
          return;
        }
        resolve();
      });
    });
  }

  private async trim(): Promise<void> {
    // Close the current stream before rewriting the file
    await this.closeStream();

    const keepBytes = Math.min(this.keepBytes, this.maxBytes);
    let retained = Buffer.alloc(0);
    let handle: FileHandle | null = null;

    // Read the tail of the file to retain the most recent content
    try {
      handle = await open(this.logPath, 'r');
    } catch {
      handle = null;
    }

    if (handle !== null) {
      try {
        const stats = await handle.stat();
        const bytesToKeep = Math.min(keepBytes, stats.size);
        retained = Buffer.alloc(bytesToKeep);
        if (bytesToKeep > 0) {
          await handle.read(retained, 0, bytesToKeep, stats.size - bytesToKeep);
        }
      } finally {
        await handle.close();
      }
    }

    // Rewrite the file with the retained content
    await writeFile(this.logPath, retained, { mode: 0o600 });
    this.currentSize = retained.length;

    // Reopen the stream in append mode
    this.writeStream = createWriteStream(this.logPath, { flags: 'a', mode: 0o600 });
  }

  private async writeToStream(data: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.writeStream.write(data, (error) => {
        if (error) {
          reject(new LogWriteError(`Failed to write to log file: ${this.logPath}`, error));
          return;
        }
        resolve();
      });
    });
  }
}
