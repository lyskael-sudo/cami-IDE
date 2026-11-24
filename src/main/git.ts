import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  GitBranches,
  GitChange,
  GitCommitResult,
  GitDiffData,
  GitFileStatusCode,
  GitRepositoryState
} from '../preload'

const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_DIFF_BYTES = 4 * 1024 * 1024
const MAX_PATHS_PER_OPERATION = 1_000

interface GitResult {
  stdout: string
}

class GitError extends Error {
  readonly stderr: string

  constructor(message: string, stderr = '') {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
  }
}

interface ParsedStatus {
  branch: string | null
  ahead: number
  behind: number
  entries: Array<GitChange & { repoPath: string }>
  hasConflicts: boolean
}

interface GitContext {
  root: string
  repositoryRoot: string
  prefix: string
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/')
}

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function runGit(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean; maxBuffer?: number } = {}
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: options.maxBuffer ?? MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C'
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim()
          if (options.allowFailure) {
            resolve({ stdout: stdout ?? '' })
            return
          }

          reject(
            new GitError(
              detail || error.message || 'La commande Git a échoué.',
              detail
            )
          )
          return
        }

        resolve({ stdout })
      }
    )
  })
}

function runGitBuffer(
  cwd: string,
  args: string[]
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'buffer',
        timeout: 15_000,
        maxBuffer: MAX_DIFF_BYTES,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C'
        }
      },
      (error, stdout) => {
        resolve(error ? null : stdout)
      }
    )
  })
}

async function resolveGitContext(root: string): Promise<GitContext | null> {
  try {
    const topLevel = await runGit(root, ['rev-parse', '--show-toplevel'])
    const repositoryRoot = path.resolve(topLevel.stdout.trim())
    if (!(await fs.stat(repositoryRoot)).isDirectory()) {
      return null
    }

    const prefixResult = await runGit(root, ['rev-parse', '--show-prefix'], {
      allowFailure: true
    })
    const prefix = normalizeSlashes(prefixResult.stdout.trim())
    return { root, repositoryRoot, prefix }
  } catch {
    return null
  }
}

function parseBranchHeader(header: string, result: ParsedStatus): void {
  if (header.startsWith('No commits yet on ')) {
    result.branch = header.slice('No commits yet on '.length)
    return
  }

  if (header === 'HEAD (no branch)') {
    result.branch = 'HEAD détaché'
    return
  }

  const [branchSegment] = header.split(' [')
  result.branch = branchSegment?.split('...')[0] || null

  const tracking = header.match(/\[([^\]]+)\]/)?.[1]
  if (tracking) {
    result.ahead = Number.parseInt(tracking.match(/ahead (\d+)/)?.[1] ?? '0', 10)
    result.behind = Number.parseInt(tracking.match(/behind (\d+)/)?.[1] ?? '0', 10)
    if (!Number.isFinite(result.ahead)) {
      result.ahead = 0
    }
    if (!Number.isFinite(result.behind)) {
      result.behind = 0
    }
  }
}

function statusCode(indexStatus: string, worktreeStatus: string): GitFileStatusCode {
  if (indexStatus === '?' && worktreeStatus === '?') {
    return '?'
  }

  if (
    indexStatus === 'U' ||
    worktreeStatus === 'U' ||
    (indexStatus === 'A' && worktreeStatus === 'A') ||
    (indexStatus === 'D' && worktreeStatus === 'D')
  ) {
    return 'U'
  }

  const selected =
    worktreeStatus !== ' ' && worktreeStatus !== '?' ? worktreeStatus : indexStatus
  if (
    selected === 'M' ||
    selected === 'A' ||
    selected === 'D' ||
    selected === 'R' ||
    selected === 'C' ||
    selected === 'T' ||
    selected === 'U'
  ) {
    return selected
  }

  return 'M'
}

function parsePorcelain(
  output: string,
  workspaceRoot: string,
  context: GitContext
): ParsedStatus {
  const result: ParsedStatus = {
    branch: null,
    ahead: 0,
    behind: 0,
    entries: [],
    hasConflicts: false
  }

  const records = output.split('\0')
  let index = 0

  if (records[0]?.startsWith('## ')) {
    parseBranchHeader(records[0].slice(3), result)
    index = 1
  }

  while (index < records.length) {
    const record = records[index]
    index += 1
    if (!record || record.length < 4) {
      continue
    }

    const indexStatus = record[0] ?? ' '
    const worktreeStatus = record[1] ?? ' '
    const repoPath = record.slice(3)
    if (!repoPath) {
      continue
    }

    let originalRepoPath: string | null = null
    if (indexStatus === 'R' || indexStatus === 'C') {
      originalRepoPath = records[index] ?? null
      index += 1
    }

    if (
      !context.prefix ||
      repoPath === context.prefix.slice(0, -1) ||
      repoPath.startsWith(context.prefix)
    ) {
      const relativePath = context.prefix
        ? repoPath.slice(context.prefix.length)
        : repoPath
      const absolutePath = path.resolve(workspaceRoot, relativePath)
      if (
        relativePath &&
        !relativePath.startsWith('../') &&
        pathIsInside(workspaceRoot, absolutePath)
      ) {
        const untracked = indexStatus === '?' && worktreeStatus === '?'
        const staged = !untracked && indexStatus !== ' ' && indexStatus !== '?'
        const unstaged =
          untracked ||
          worktreeStatus === 'M' ||
          worktreeStatus === 'D' ||
          worktreeStatus === 'T' ||
          worktreeStatus === 'U'

        result.entries.push({
          path: absolutePath,
          relativePath: normalizeSlashes(relativePath),
          repoPath,
          originalPath: originalRepoPath,
          indexStatus,
          worktreeStatus,
          staged,
          unstaged,
          untracked,
          status: statusCode(indexStatus, worktreeStatus)
        })

        if (statusCode(indexStatus, worktreeStatus) === 'U') {
          result.hasConflicts = true
        }
      }
    }
  }

  return result
}

async function readParsedStatus(root: string): Promise<{
  context: GitContext | null
  parsed: ParsedStatus | null
}> {
  const context = await resolveGitContext(root)
  if (!context) {
    return { context: null, parsed: null }
  }

  try {
    const { stdout } = await runGit(context.repositoryRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--branch',
      '--untracked-files=all'
    ])
    return { context, parsed: parsePorcelain(stdout, root, context) }
  } catch {
    return { context, parsed: null }
  }
}

export async function readGitRepositoryState(root: string): Promise<GitRepositoryState> {
  const { parsed } = await readParsedStatus(root)
  if (!parsed) {
    return {
      isRepository: false,
      root: null,
      branch: null,
      ahead: 0,
      behind: 0,
      changes: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      hasConflicts: false,
      entries: []
    }
  }

  const entries: GitChange[] = parsed.entries.map(
    ({ repoPath: _repoPath, ...entry }) => entry
  )
  return {
    isRepository: true,
    root,
    branch: parsed.branch,
    ahead: parsed.ahead,
    behind: parsed.behind,
    changes: entries.length,
    staged: entries.filter((entry) => entry.staged).length,
    unstaged: entries.filter((entry) => entry.unstaged).length,
    untracked: entries.filter((entry) => entry.untracked).length,
    hasConflicts: parsed.hasConflicts,
    entries
  }
}

function validateWorkspacePath(root: string, filePath: string): string {
  const resolved = path.resolve(filePath)
  if (!pathIsInside(root, resolved) || resolved === root) {
    throw new GitError('Le fichier demandé se trouve hors du dossier de travail.')
  }
  return resolved
}

function validatePathList(root: string, input: string[]): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new GitError('Aucun fichier sélectionné.')
  }

  if (input.length > MAX_PATHS_PER_OPERATION) {
    throw new GitError('Trop de fichiers dans cette opération Git.')
  }

  const paths = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string' || item.includes('\0')) {
      throw new GitError('Chemin Git invalide.')
    }
    paths.add(validateWorkspacePath(root, item))
  }

  return [...paths]
}

function toRelativePaths(root: string, paths: string[]): string[] {
  return paths.map((entry) => normalizeSlashes(path.relative(root, entry)))
}

async function hasHead(repositoryRoot: string): Promise<boolean> {
  try {
    await runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

export async function stageGitPaths(root: string, input: string[]): Promise<void> {
  const absolutePaths = validatePathList(root, input)
  const relativePaths = toRelativePaths(root, absolutePaths)
  await runGit(root, ['add', '--', ...relativePaths])
}

export async function unstageGitPaths(root: string, input: string[]): Promise<void> {
  const absolutePaths = validatePathList(root, input)
  const relativePaths = toRelativePaths(root, absolutePaths)
  const context = await resolveGitContext(root)
  if (!context) {
    throw new GitError('Aucun dépôt Git n’est associé à ce dossier.')
  }

  if (await hasHead(context.repositoryRoot)) {
    await runGit(root, ['restore', '--staged', '--', ...relativePaths])
  } else {
    await runGit(root, [
      'rm',
      '--cached',
      '--ignore-unmatch',
      '--quiet',
      '--',
      ...relativePaths
    ])
  }
}

export async function stageAllGitPaths(root: string): Promise<void> {
  await runGit(root, ['add', '-A', '--', '.'])
}

export async function unstageAllGitPaths(root: string): Promise<void> {
  const context = await resolveGitContext(root)
  if (!context) {
    throw new GitError('Aucun dépôt Git n’est associé à ce dossier.')
  }

  if (await hasHead(context.repositoryRoot)) {
    await runGit(root, ['restore', '--staged', '--', '.'])
  } else {
    await runGit(root, ['rm', '-r', '--cached', '--ignore-unmatch', '--quiet', '--', '.'])
  }
}

export async function commitGitChanges(
  root: string,
  messageInput: string
): Promise<GitCommitResult> {
  const message = messageInput.trim()
  if (!message) {
    throw new GitError('Saisissez un message de validation.')
  }
  if (message.length > 10_000 || message.includes('\0')) {
    throw new GitError('Message de validation invalide.')
  }

  try {
    const { stdout } = await runGit(root, ['commit', '-m', message])
    return {
      success: true,
      message: stdout.trim() || 'Modifications validées.'
    }
  } catch (error) {
    if (error instanceof GitError) {
      throw new GitError(error.stderr || error.message)
    }
    throw error
  }
}

export async function readGitBranches(root: string): Promise<GitBranches> {
  const context = await resolveGitContext(root)
  if (!context) {
    return { current: null, branches: [] }
  }

  const status = await readGitRepositoryState(root)
  try {
    const { stdout } = await runGit(context.repositoryRoot, [
      'branch',
      '--format=%(refname:short)',
      '--sort=-committerdate'
    ])
    const branches = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.includes('\0'))
      .slice(0, 500)

    return {
      current: status.branch,
      branches
    }
  } catch {
    return { current: status.branch, branches: [] }
  }
}

function validateBranchName(branch: string): void {
  if (
    typeof branch !== 'string' ||
    branch.length === 0 ||
    branch.length > 200 ||
    branch.startsWith('-') ||
    branch.includes('\0') ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
  ) {
    throw new GitError('Nom de branche invalide.')
  }
}

export async function checkoutGitBranch(root: string, branch: string): Promise<void> {
  validateBranchName(branch)
  const branches = await readGitBranches(root)
  if (!branches.branches.includes(branch)) {
    throw new GitError(`La branche « ${branch} » n’existe pas.`)
  }

  await runGit(root, ['switch', branch])
}

async function readWorkingTreeFile(filePath: string): Promise<Buffer | null> {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile() || stats.size > MAX_DIFF_BYTES) {
      return null
    }
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

function containsNul(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8_192)
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) {
      return true
    }
  }
  return false
}

function decodeBuffer(buffer: Buffer | null): string {
  if (!buffer) {
    return ''
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

export async function readGitDiff(
  root: string,
  filePathInput: string,
  staged: boolean
): Promise<GitDiffData> {
  const filePath = validateWorkspacePath(root, filePathInput)
  const { context, parsed } = await readParsedStatus(root)
  if (!context || !parsed) {
    throw new GitError('Aucun dépôt Git n’est associé à ce dossier.')
  }

  const entry = parsed.entries.find((candidate) => candidate.path === filePath)
  if (!entry) {
    throw new GitError('Ce fichier n’a aucune modification Git.')
  }

  const repoPath = entry.repoPath
  const originalRepoPath = entry.originalPath ?? repoPath
  const headSpec = `HEAD:${originalRepoPath}`
  const indexSpec = `:${repoPath}`

  let originalBuffer: Buffer | null = null
  let modifiedBuffer: Buffer | null = null

  if (staged) {
    if (!entry.staged) {
      throw new GitError('Ce fichier ne contient aucune modification indexée.')
    }

    if (entry.indexStatus !== 'A' && entry.indexStatus !== '?') {
      originalBuffer = await runGitBuffer(context.repositoryRoot, ['show', headSpec])
    }
    modifiedBuffer =
      entry.indexStatus === 'D'
        ? null
        : await runGitBuffer(context.repositoryRoot, ['show', indexSpec])
  } else {
    if (!entry.unstaged) {
      throw new GitError('Ce fichier ne contient aucune modification non indexée.')
    }

    if (entry.untracked) {
      originalBuffer = null
    } else {
      originalBuffer = await runGitBuffer(context.repositoryRoot, ['show', indexSpec])
    }
    modifiedBuffer = await readWorkingTreeFile(filePath)
  }

  const original = originalBuffer ?? Buffer.alloc(0)
  const modified = modifiedBuffer ?? Buffer.alloc(0)
  if (original.length > MAX_DIFF_BYTES || modified.length > MAX_DIFF_BYTES) {
    throw new GitError('Ce fichier est trop volumineux pour être affiché en diff.')
  }

  const isBinary = containsNul(original) || containsNul(modified)

  return {
    path: filePath,
    relativePath: entry.relativePath,
    staged,
    status: entry.status,
    original: isBinary ? '' : decodeBuffer(original),
    modified: isBinary ? '' : decodeBuffer(modified),
    isBinary
  }
}

export function getGitErrorMessage(error: unknown): string {
  if (error instanceof GitError) {
    return error.stderr || error.message
  }
  return error instanceof Error ? error.message : String(error)
}
