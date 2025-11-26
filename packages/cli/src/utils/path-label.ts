import { homedir } from 'os';
import { sep } from 'path';

/**
 * Replace the user's home directory prefix with ~ for display.
 */
export function shortenHomePath(path: string): string {
  const home = homedir();
  if (!home) {
    return path;
  }

  const homeWithSep = home.endsWith(sep) ? home : `${home}${sep}`;

  if (path === home) {
    return '~';
  }

  if (path.startsWith(homeWithSep)) {
    return `~${path.slice(home.length)}`;
  }

  return path;
}
