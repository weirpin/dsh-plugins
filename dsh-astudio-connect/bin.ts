#!/usr/bin/env node
/** Standalone status/diagnostics CLI for the dsh-astudio-connect bundle. */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AstudioCredentialStore } from './auth.ts'
import { AstudioCatalogStore } from './catalog-store.ts'
import { resolveAstudioDataRoot, sessionPathIn, userDataDir } from './data-location.ts'
import { ASTUDIO_CONNECT_VERSION } from './version.ts'

type Action = 'doctor' | 'logout' | 'status'

const JSON_SCHEMA_VERSION = 1

/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{16,}\b/gu, '[redacted token]')
}

function printHelp(): void {
  process.stdout.write([
    'Usage: dsh-astudio-connect <doctor|status|logout> [--json]',
    '',
    '  doctor   secret-free sign-in and environment diagnostics',
    '  status   sign-in state and model catalog source',
    '  logout   report that the desktop app sign-in is untouched (no plugin-owned credential)',
    '',
    '  --json      emit one secret-free JSON document (doctor/status only)',
    '',
  ].join('\n'))
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

/** Build the credential store and catalog store for diagnostics. */
function makeStores(): { store: AstudioCredentialStore; catalog: AstudioCatalogStore } {
  const store = new AstudioCredentialStore()
  const catalog = new AstudioCatalogStore({
    resolveUserDataDir: () => {
      const { dataRoot } = resolveAstudioDataRoot()
      return dataRoot !== undefined ? userDataDir(dataRoot) : undefined
    },
  })
  return { store, catalog }
}

async function doctor(jsonOutput: boolean): Promise<number> {
  const { store, catalog } = makeStores()
  const authStatus = await store.status()
  const { dataRoot, source: dataRootSource } = resolveAstudioDataRoot()
  const sessionPath = store.resolveSessionPath().path
  const read = await catalog.current()

  const report = {
    schemaVersion: JSON_SCHEMA_VERSION,
    package: 'dsh-astudio-connect',
    version: ASTUDIO_CONNECT_VERSION,
    node: process.version,
    dataRoot: {
      path: dataRoot ?? '(not found)',
      source: dataRootSource,
    },
    sessionFile: {
      path: sessionPath ?? '(not found)',
      present: authStatus.sessionPresent,
    },
    signIn: authStatus.state,
    ...authStatus.reason !== undefined ? { reason: authStatus.reason } : {},
    catalog: {
      source: read.source,
      modelCount: read.models.length,
      ...read.accountHash !== undefined ? { accountHash: read.accountHash } : {},
      ...read.error !== undefined ? { error: read.error } : {},
    },
    hints: [
      ...authStatus.state === 'signed-out' ? [`Sign in once in the AStudio desktop app, then run status again.`] : [],
      ...dataRoot === undefined ? ['No AStudio data root found; set ASTUDIO_DATA_ROOT or ASTUDIO_AUTH_FILE if it lives elsewhere.'] : [],
      ...read.source === 'builtin' ? ['Serving the compiled-in fallback model list; a live catalog was not found on disk.'] : [],
    ],
  }

  if (jsonOutput) {
    printJson(report)
  } else {
    process.stdout.write([
      `AStudio Connect ${ASTUDIO_CONNECT_VERSION} on ${process.version}`,
      `Data root: ${report.dataRoot.path} (${dataRootSource})`,
      `Session file: ${report.sessionFile.present ? 'present' : 'missing'} — ${sessionPath ?? '(not found)'}`,
      `Sign-in state: ${report.signIn}`,
      ...authStatus.reason !== undefined ? [`Reason: ${authStatus.reason}`] : [],
      `Catalog: ${read.source} (${read.models.length} models)`,
      ...read.error !== undefined ? [`Catalog note: ${read.error}`] : [],
      ...report.hints.map(hint => `Hint: ${hint}`),
      '',
    ].join('\n'))
  }
  return authStatus.state === 'signed-in' && dataRoot !== undefined ? 0 : 1
}

async function status(jsonOutput: boolean): Promise<number> {
  const { store, catalog } = makeStores()
  const authStatus = await store.status()

  if (authStatus.state !== 'signed-in') {
    if (jsonOutput) {
      printJson({
        schemaVersion: JSON_SCHEMA_VERSION,
        package: 'dsh-astudio-connect',
        version: ASTUDIO_CONNECT_VERSION,
        status: 'signed-out',
        ...authStatus.reason !== undefined ? { reason: authStatus.reason } : {},
      })
    } else {
      process.stdout.write([
        `AStudio Connect: signed out`,
        ...authStatus.reason !== undefined ? [`Reason: ${authStatus.reason}`] : [],
        '',
      ].join('\n'))
    }
    return 1
  }

  const read = await catalog.current()
  if (jsonOutput) {
    printJson({
      schemaVersion: JSON_SCHEMA_VERSION,
      package: 'dsh-astudio-connect',
      version: ASTUDIO_CONNECT_VERSION,
      status: 'signed-in',
      accountId: authStatus.credential?.accountId ?? '',
      catalogSource: read.source,
      catalogModels: read.models.length,
      ...read.accountHash !== undefined ? { accountHash: read.accountHash } : {},
      ...read.error !== undefined ? { catalogError: read.error } : {},
    })
  } else {
    process.stdout.write([
      `AStudio Connect: signed in (account ${authStatus.credential?.accountId ?? 'unknown'})`,
      `Catalog: ${read.source} (${read.models.length} models)`,
      ...read.error !== undefined ? [`Catalog note: ${read.error}`] : [],
      ...read.accountHash !== undefined ? [`Account hash: ${read.accountHash.slice(0, 12)}…`] : [],
      '',
    ].join('\n'))
  }
  return 0
}

/** Execute one boot-free command. */
export async function run(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return 0
  }
  const [rawAction, ...flags] = argv
  const actions: readonly Action[] = ['doctor', 'logout', 'status']
  if (!actions.includes(rawAction as Action)) {
    process.stderr.write(`dsh-astudio-connect: expected doctor, logout, or status; got ${JSON.stringify(rawAction)}\n`)
    return 1
  }
  const action = rawAction as Action
  const jsonOutput = flags.includes('--json')

  const unknown = flags.filter(flag => flag !== '--json')
  if (unknown.length > 0 || (jsonOutput && action === 'logout')) {
    process.stderr.write(`dsh-astudio-connect: invalid options for ${action}: ${flags.join(' ')}\n`)
    return 1
  }
  try {
    switch (action) {
      case 'doctor':
        return await doctor(jsonOutput)
      case 'status':
        return await status(jsonOutput)
      case 'logout':
        process.stdout.write('AStudio Connect: no plugin-owned credential to remove; the desktop app sign-in is untouched\n')
        return 0
    }
  } catch (error: unknown) {
    process.stderr.write(`dsh-astudio-connect: ${action} failed: ${safeMessage(error)}\n`)
    return 1
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2))
}
