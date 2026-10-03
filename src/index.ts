/**
 * AStudio models for DeepSeek Harness, reusing the AStudio desktop app's
 * sign-in. Registers one provider — `astudio` — while streaming, tool calls,
 * compaction, and permissions stay Harness-owned.
 *
 * Unlike the reference WorkBuddy route (which stands a loopback shim in front
 * of a non-OpenAI upstream), the AStudio gateway speaks the OpenAI Responses
 * API natively, so the pi-ai provider points at the gateway directly. The
 * bearer credential is resolved per request from the desktop session file, and
 * the model catalog is re-read from disk on every adoption — no network is
 * involved in either.
 *
 * @module dsh-astudio-connect
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AstudioCredentialStore } from './auth.ts'
import type { AstudioModelInfo } from './catalog.ts'
import { AstudioCatalogStore } from './catalog-store.ts'
import { createAstudioAdapter } from './adapter.ts'
import { resolveAstudioDataRoot, userDataDir } from './data-location.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-astudio'

/** The model registry required before the provider can register. */
export const inject = ['llm']

/** How often the credential file is re-checked, in milliseconds. */
const CREDENTIAL_POLL_MS = 30_000

/** Floor and ceiling for the overridable poll interval. */
const MIN_POLL_MS = 100
const MAX_POLL_MS = 24 * 60 * 60 * 1000

/**
 * Resolve the sweep interval, honoring the override when it is usable.
 * `DSH_ASTUDIO_POLL_MS` exists so the sweep can be exercised end to end in
 * tests and shortened while diagnosing a slow sign-in on a real machine; it is
 * not a product setting and no UI exposes it.
 */
function credentialPollMs(): number {
  const override = Number(process.env['DSH_ASTUDIO_POLL_MS'])
  if (!Number.isFinite(override) || override < MIN_POLL_MS) return CREDENTIAL_POLL_MS
  return Math.min(override, MAX_POLL_MS)
}

/** Plugin configuration. */
export interface Config {
  /** Explicit AStudio desktop session-file path, overriding env and platform defaults. */
  authFile?: string
}

/** The plugin config schema. */
export const Config: z<Config> = z.object({
  authFile: z.string().description('AStudio desktop session file (defaults to the app data root)'),
})

/**
 * Start the AStudio provider: its credential-driven catalog lifecycle and its
 * credential sweep.
 *
 * The adapter registers unconditionally; what varies is whether the catalog is
 * populated. An empty catalog is how DSH hides a model group, which keeps a
 * sign-in that happens after startup working without re-registering the provider.
 */
export function apply(ctx: Context, config: Config): void {
  let stopped = false
  const timers: NodeJS.Timeout[] = []

  const store = new AstudioCredentialStore({ authFile: config.authFile })
  const catalogStore = new AstudioCatalogStore({
    resolveUserDataDir: () => {
      const { dataRoot } = resolveAstudioDataRoot()
      return dataRoot !== undefined ? userDataDir(dataRoot) : undefined
    },
  })

  // The live catalog snapshot the adapter serves. Mutated on each adoption.
  const liveCatalog = { models: [] as AstudioModelInfo[] }

  const adapter = createAstudioAdapter({ store, catalog: liveCatalog })

  /** Adopt one account identity, serving its models or hiding the group. */
  const adopt = async (identity: string | undefined): Promise<void> => {
    if (identity === undefined) {
      liveCatalog.models = []
    } else {
      const read = await catalogStore.current()
      liveCatalog.models = read.models
    }
    adapter.invalidate()
    ctx.emit('llm/adapters-updated')
  }

  /** Reconcile with the current credential, adopting the account or signing out. */
  const sync = async (): Promise<void> => {
    if (stopped) return
    let status
    try {
      status = await store.status()
    } catch (error: unknown) {
      ctx.logger.warn('dsh-astudio-connect: credential read failed', error)
      return
    }
    if (stopped) return
    if (status.credential !== undefined) {
      await adopt(status.credential.accountId || status.credential.uid)
    } else {
      await adopt(undefined)
    }
  }

  // Register the adapter. Only the adapter registers — no configurable-provider
  // directory entry, so the Models settings page does not list this provider
  // (its editor has no fields to offer).
  const releaseAdapter = ctx.llm.registerAdapter(['astudio'], adapter.adapter)

  // Register cleanup. ctx.effect throws when the context is already disposed,
  // so the cleanup must also run manually in that case.
  const cleanup = (): void => {
    stopped = true
    releaseAdapter()
    for (const timer of timers) clearInterval(timer)
    timers.length = 0
  }
  try {
    ctx.effect(() => cleanup)
  } catch {
    cleanup()
  }

  // Initial adoption, then poll. Skipped when the context was already disposed.
  if (!stopped) {
    void sync()
    const timer = setInterval(() => { void sync() }, credentialPollMs())
    timer.unref?.()
    timers.push(timer)
  }
}
