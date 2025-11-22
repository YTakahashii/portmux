import { createHash } from 'crypto';

function slugifyBranch(branch?: string): string | undefined {
  if (!branch) {
    return undefined;
  }
  return branch
    .replace(/^refs\/heads\//, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildGroupInstanceId(
  repositoryName: string,
  groupDefinitionName: string,
  worktreePath: string
): string {
  const hash = createHash('sha1').update(worktreePath).digest('hex').slice(0, 10);
  return `${repositoryName}::${groupDefinitionName}::${hash}`;
}

export function buildGroupLabel(repositoryName: string, branchLabel?: string): string {
  const normalizedBranch = slugifyBranch(branchLabel);
  if (!normalizedBranch) {
    return repositoryName;
  }
  return `${repositoryName}:${normalizedBranch}`;
}
