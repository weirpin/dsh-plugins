/**
 * The AStudio credential store: locate and parse the desktop app's
 * `astron-session.json`, plus the Codex-style `config.toml` fallback the app
 * itself maintains, without ever copying the token somewhere else.
 *
 * The session file is read-only here — the desktop app owns it. There is no
 * plugin-owned credential copy in this build (the reference WorkBuddy plugin
 * keeps one so its `logout` can remove it; AStudio sessions are app-owned, so
 * `logout` only reports that).
 *
 * @module dsh-astudio-connect/auth
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveAcodeHomes,
  resolveSessionPath,
  type LocationEnvironment,
} from './data-location.ts'

/** The bearer credential the AStudio model gateway accepts. */
export const ASTUDIO_PROVIDER_ID = 'astudio'

/** Provider name the desktop app writes into its own config (`astron-spark`). */
const CONFIG_PROVIDER_SECTION = 'model_providers.astron-spark'

/** The bearer-token key inside that section. */
const CONFIG_TOKEN_KEY = 'experimental_bearer_token'

/** One signed-in account's credentials, as parsed from the session file. */
export interface AstudioCredential {
  accountId: string
  uid: string
  /** The app's own session token (unused for model calls; kept for identity). */
  token: string
  /** The bearer credential sent to the model gateway as `Authorization: Bearer`. */
  modelBearerToken: string
  ssoSessionId?: string
  loggedInAt?: string
  loginMethod?: string
  /** Absolute path of the session file that produced this credential. */
  sessionPath: string
}

/** Sign-in state of the desktop app on this machine. */
export interface AstudioAuthStatus {
  state: 'signed-in' | 'signed-out'
  /** Why the state is what it is (missing file, unreadable file, bad shape). */
  reason?: string
  sessionPath: string | undefined
  sessionPresent: boolean
  credential: AstudioCredential | undefined
}

/** Options for {@link AstudioCredentialStore}. */
export interface AstudioCredentialStoreOptions {
  /** Explicit `astron-session.json` path, overriding env and platform defaults. */
  authFile?: string
  location?: LocationEnvironment
}

/** Parse one quoted TOML assignment value, honoring basic escapes. */
export function parseQuotedAssignmentValue(line: string, key: string): string | undefined {
  const assign = line.indexOf('=')
  if (assign < 0) return undefined
  const trimmed = line.slice(assign + 1).trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const raw = trimmed.slice(1, -1)
    return raw.replace(/\\(["\\])/gu, '$1')
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith('"') === false && trimmed.startsWith("'") === false) {
    const bare = trimmed.split(/\s+/)[0]
    return bare === undefined || bare === '' ? undefined : bare
  }
  return undefined
}

/**
 * Read `experimental_bearer_token` from the `[model_providers.astron-spark]`
 * section of a Codex-style config — the same spelling the desktop app writes.
 * Mirrors the desktop's own parser (section match, then the first quoted
 * assignment for the key), so hand-edited files behave the same way.
 */
export function parseConfigProviderBearerToken(content: string): string | undefined {
  let inSection = false
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      inSection = trimmed === `[${CONFIG_PROVIDER_SECTION}]`
      continue
    }
    if (!inSection) continue
    // Only match the exact key we're looking for
    if (!trimmed.startsWith(`${CONFIG_TOKEN_KEY} `) && !trimmed.startsWith(`${CONFIG_TOKEN_KEY}=`)) continue
    const value = parseQuotedAssignmentValue(trimmed, CONFIG_TOKEN_KEY)
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/** Read the bearer token from one acode-home `config.toml`, when it exists. */
export function bearerTokenFromConfigHome(configHome: string): string | undefined {
  const file = join(configHome, 'config.toml')
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  return parseConfigProviderBearerToken(content)
}

/** Shape guard for the session file's meaningful fields. */
function isSessionLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record['modelBearerToken'] === 'string' || typeof record['token'] === 'string'
}

/** Read and parse the session file at `path`; `undefined` when absent. */
function readSessionFile(path: string): { raw: unknown } | { error: string } | undefined {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined
    return { error: `cannot read session file: ${(error as Error).message}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    return { error: `session file is not valid JSON: ${(error as Error).message}` }
  }
  return { raw: parsed }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Locate and parse the desktop app's credentials. Every read is a fresh
 * stat+read, so an account change made while DSH is already running is seen
 * on the next poll without a restart.
 */
export class AstudioCredentialStore {
  constructor(private readonly options: AstudioCredentialStoreOptions = {}) {}

  /** The resolved session file path (for diagnostics), without reading it. */
  resolveSessionPath(): { path: string | undefined; source: 'env' | 'data-root' | 'none' } {
    return resolveSessionPath({ authFile: this.options.authFile }, this.options.location)
  }

  /** Current sign-in state, parsed fresh from disk on every call. */
  async status(): Promise<AstudioAuthStatus> {
    const { path } = this.resolveSessionPath()
    if (path === undefined) {
      return {
        state: 'signed-out',
        reason: 'AStudio data root not found (set ASTUDIO_DATA_ROOT or ASTUDIO_AUTH_FILE)',
        sessionPath: undefined,
        sessionPresent: false,
        credential: undefined,
      }
    }
    const read = readSessionFile(path)
    if (read === undefined) {
      return {
        state: 'signed-out',
        reason: 'session file not found (the desktop app is not signed in here)',
        sessionPath: path,
        sessionPresent: false,
        credential: undefined,
      }
    }
    if ('error' in read) {
      return {
        state: 'signed-out',
        reason: read.error,
        sessionPath: path,
        sessionPresent: true,
        credential: undefined,
      }
    }
    if (!isSessionLike(read.raw)) {
      return {
        state: 'signed-out',
        reason: 'session file has no token fields',
        sessionPath: path,
        sessionPresent: true,
        credential: undefined,
      }
    }
    const bearer = str(read.raw['modelBearerToken']) ?? str(read.raw['token'])
    if (bearer === undefined) {
      return {
        state: 'signed-out',
        reason: 'session file carries no usable bearer token',
        sessionPath: path,
        sessionPresent: true,
        credential: undefined,
      }
    }
    return {
      state: 'signed-in',
      sessionPath: path,
      sessionPresent: true,
      credential: {
        accountId: str(read.raw['accountId']) ?? '',
        uid: str(read.raw['uid']) ?? '',
        token: str(read.raw['token']) ?? '',
        modelBearerToken: bearer,
        ssoSessionId: str(read.raw['ssoSessionId']),
        loggedInAt: str(read.raw['loggedInAt']),
        loginMethod: str(read.raw['loginMethod']),
        sessionPath: path,
      },
    }
  }

  /** The bearer credential for model calls, or `undefined` when signed out. */
  async token(): Promise<string | undefined> {
    const credential = (await this.status()).credential
    return credential?.modelBearerToken ?? undefined
  }

  /**
   * The bearer token from the desktop app's Codex-style provider config, as a
   * fallback for session files that predate `modelBearerToken`.
   */
  async configToken(): Promise<string | undefined> {
    for (const home of resolveAcodeHomes(this.options.location)) {
      const token = bearerTokenFromConfigHome(home)
      if (token !== undefined && token !== '') return token
    }
    return undefined
  }

  /**
   * The effective bearer credential: the session file first, the app's own
   * provider config second.
   */
  async effectiveToken(): Promise<string | undefined> {
    return (await this.token()) ?? (await this.configToken())
  }
}
