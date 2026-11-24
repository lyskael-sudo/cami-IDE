import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const executableCache = new Map<string, Promise<string | null>>()

function pathDirectories(): string[] {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function executableExtensions(): string[] {
  if (process.platform !== 'win32') {
    return ['']
  }

  return (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate)
    if (!stats.isFile()) {
      return false
    }

    if (process.platform === 'win32') {
      return true
    }

    await fs.access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findExecutableUncached(command: string): Promise<string | null> {
  if (!command || command.includes('\0')) {
    return null
  }

  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    const resolved = path.resolve(command)
    return (await isExecutable(resolved)) ? resolved : null
  }

  const extensions = executableExtensions()
  for (const directory of pathDirectories()) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`)
      if (await isExecutable(candidate)) {
        return candidate
      }
    }
  }

  return null
}

export function findExecutable(command: string): Promise<string | null> {
  const cacheKey = `${process.platform}\0${process.env.PATH ?? ''}\0${command}`
  const cached = executableCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const lookup = findExecutableUncached(command).catch(() => null)
  executableCache.set(cacheKey, lookup)
  return lookup
}

export async function firstExecutable(
  candidates: Array<{ command: string; args?: string[] }>
): Promise<{ command: string; args: string[] } | null> {
  for (const candidate of candidates) {
    const resolved = await findExecutable(candidate.command)
    if (resolved) {
      return {
        command: resolved,
        args: candidate.args ?? []
      }
    }
  }

  return null
}

export function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_ENABLE_LOGGING
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  delete environment.ELECTRON_RUN_AS_NODE
  environment.FORCE_COLOR = '0'
  environment.NO_COLOR = '1'
  return environment
}

export function clearExecutableCache(): void {
  executableCache.clear()
}
