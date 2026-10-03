/**
 * Resolve where the AStudio desktop app keeps its local data on this machine,
 * and where its sign-in session file lives.
 *
 * The desktop app stores everything under one *data root*:
 *
 *   <dataRoot>/userdata/astron-session.json      ← account token (our credential)
 *   <dataRoot>/userdata/model-gateway/*.json     ← account-scoped model catalog
 *   <dataRoot>/runtime/acode-home/config.toml   ← Codex-style provider config
 *
 * On Windows the app records its data root in the registry key
 * `HKCU\Software\AStudioStorage` (values `ProductionDataRoot` /
 * `ProductionManagedStorageRoot`). Earlier builds and non-Windows installs
 * fall back to conventional locations.
 *
 * @module dsh-astudio-connect/data-location
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Registry key the desktop app writes its storage location record into. */
export const ASTUDIO_STORAGE_REGISTRY_KEY = String.raw`HKCU\Software\AStudioStorage`

/** Environment override for the whole AStudio data root. */
export const ASTUDIO_DATA_ROOT_ENV = 'ASTUDIO_DATA_ROOT'

/** Environment override pointing directly at astron-session.json. */
export const ASTUDIO_AUTH_FILE_ENV = 'ASTUDIO_AUTH_FILE'

/** The session file inside `<dataRoot>/userdata` that carries the account token. */
export const ASTUDIO_SESSION_FILENAME = 'astron-session.json'

/** Registry value holding the data root. */
const REGISTRY_DATA_ROOT_VALUE = 'ProductionDataRoot'

/** Where the data root was found (or why not). */
export type DataRootSource = 'env' | 'registry' | 'default' | 'none'

/** Where the session file was found. */
export type SessionPathSource = 'env' | 'data-root' | 'none'

/** Injectable environment so tests can exercise every branch. */
export interface LocationEnvironment {
  env: NodeJS.ProcessEnv
  homeDir: string
  homeDirs: () => string[]
  spawn: (command: string, args: string[]) => SpawnSyncReturns<Buffer>
  /** Check whether a directory looks like an AStudio data root. */
  looksLikeDataRoot?: (dir: string) => boolean
}

/** Default environment: the real process env, home dir, and a reg-query spawn. */
export function defaultLocationEnvironment(): LocationEnvironment {
  return {
    env: process.env,
    homeDir: homedir(),
    homeDirs: () => [homedir()],
    spawn: (command, args) => {
      const result = spawnSync(command, args, { encoding: 'buffer' })
      if (result.error) throw result.error
      return result
    },
    looksLikeDataRoot: defaultLooksLikeDataRoot,
  }
}

/** Read one registry value with `reg query ... /reg:64`; undefined when absent. */
function queryRegistryValue(
  spawn: LocationEnvironment['spawn'],
  key: string,
  value: string,
): string | undefined {
  const result = spawn('reg', ['query', key, '/reg:64'])
  if (result.status !== 0) return undefined
  const text = result.stdout.toString('utf8')
  const line = text
    .split(/\r?\n/)
    .find(l => l.trim().startsWith(value) && l.includes('REG_SZ'))
  if (line === undefined) return undefined
  const parts = line.trim().split(/\s+/)
  return parts.slice(2).join(' ').trim() || undefined
}

/**
 * The conventional data-root locations, in probe order. The desktop app's own
 * derivation is "parent of the install directory + AStudio Data"; a plain
 * install under either Program Files root lands in one of the entries below.
 */
function candidateDataRoots(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const candidates: string[] = []
  for (const localAppData of [env.LOCALAPPDATA, join(homeDir, 'AppData', 'Local')]) {
    if (localAppData !== undefined && localAppData.length > 0) {
      candidates.push(join(localAppData, 'Programs', 'AStudio Data'))
    }
  }
  for (const programFiles of ['C:\\Program Files', 'D:\\Program Files']) {
    candidates.push(join(programFiles, 'AStudio Data'))
  }
  if (env.APPDATA !== undefined && env.APPDATA.length > 0) {
    candidates.push(join(env.APPDATA, 'AStudio Data'))
  }
  return candidates
}

/** True when a directory looks like an AStudio data root (has a userdata dir). */
export function defaultLooksLikeDataRoot(dir: string): boolean {
  return existsSync(join(dir, 'userdata'))
}

/**
 * Resolve the AStudio data root, or `undefined` when none of the known sources
 * yields one. Resolution order: explicit env override, the registry record,
 * then conventional install locations.
 */
export function resolveAstudioDataRoot(
  options: LocationEnvironment = defaultLocationEnvironment(),
): { dataRoot: string | undefined; source: DataRootSource } {
  const configured = options.env[ASTUDIO_DATA_ROOT_ENV]?.trim()
  if (configured !== undefined && configured.length > 0) {
    return { dataRoot: configured, source: 'env' }
  }
  if (process.platform === 'win32') {
    const fromRegistry = queryRegistryValue(options.spawn, ASTUDIO_STORAGE_REGISTRY_KEY, REGISTRY_DATA_ROOT_VALUE)
    if (fromRegistry !== undefined && fromRegistry.length > 0) {
      return { dataRoot: fromRegistry, source: 'registry' }
    }
  }
  const looksLikeDataRoot = options.looksLikeDataRoot ?? defaultLooksLikeDataRoot
  for (const candidate of candidateDataRoots(options.env, options.homeDir)) {
    if (looksLikeDataRoot(candidate)) return { dataRoot: candidate, source: 'default' }
  }
  return { dataRoot: undefined, source: 'none' }
}

/** The userdata directory inside a data root. */
export function userDataDir(dataRoot: string): string {
  return join(dataRoot, 'userdata')
}

/** The session file inside a data root. */
export function sessionPathIn(dataRoot: string): string {
  return join(userDataDir(dataRoot), ASTUDIO_SESSION_FILENAME)
}

/**
 * Resolve the path of `astron-session.json`. An explicit `authFile` (plugin
 * config or `ASTUDIO_AUTH_FILE`) wins; otherwise the session file inside the
 * resolved data root.
 */
export function resolveSessionPath(
  options: { authFile?: string } | undefined,
  location: LocationEnvironment = defaultLocationEnvironment(),
): { path: string | undefined; source: SessionPathSource } {
  const explicit = options?.authFile?.trim() || location.env[ASTUDIO_AUTH_FILE_ENV]?.trim()
  if (explicit !== undefined && explicit.length > 0) {
    return { path: explicit, source: 'env' }
  }
  const { dataRoot } = resolveAstudioDataRoot(location)
  if (dataRoot === undefined) return { path: undefined, source: 'none' }
  return { path: sessionPathIn(dataRoot), source: 'data-root' }
}

/**
 * Candidate acode homes (Codex-style provider config with the bearer token)
 * for credential fallback: the data root's runtime home first, then `~/.acode`.
 */
export function resolveAcodeHomes(
  options: LocationEnvironment = defaultLocationEnvironment(),
): string[] {
  const { dataRoot } = resolveAstudioDataRoot(options)
  const homes: string[] = []
  if (dataRoot !== undefined) homes.push(join(dataRoot, 'runtime', 'acode-home'))
  homes.push(join(options.homeDir, '.acode'))
  return homes
}
