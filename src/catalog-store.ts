/**
 * The catalog store: read the desktop app's on-disk model catalog fresh on
 * every adoption, so an account switch (or a re-login) immediately serves the
 * new account's models. No network is involved — the app itself syncs its
 * gateway catalog to disk, and this store only re-reads it.
 *
 * Source priority on each read:
 *
 * 1. `<userdata>/model-gateway/catalog-*.json` (newest by mtime) — the
 *    app's own per-account gateway catalog; carries capacities and badges.
 * 2. `<userdata>/provider-model-catalog-v1.json` — the server-synced roster.
 * 3. The compiled-in fallback roster.
 *
 * @module dsh-astudio-connect/catalog-store
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FALLBACK_ASTUDIO_MODELS,
  parseGatewayCatalog,
  parseProviderCatalog,
  providerModelsToInfos,
  type AstudioCatalog,
  type AstudioCatalogSource,
} from './catalog.ts'

/** The gateway catalog file prefix inside `<userdata>/model-gateway`. */
export const ASTUDIO_GATEWAY_CATALOG_PREFIX = 'catalog-'

/** The server-synced roster filename inside `<userdata>`. */
export const ASTUDIO_PROVIDER_CATALOG_FILENAME = 'provider-model-catalog-v1.json'

/** Options for {@link AstudioCatalogStore}. */
export interface AstudioCatalogStoreOptions {
  /** Resolve the current `<dataRoot>/userdata` directory (undefined when gone). */
  resolveUserDataDir: () => string | undefined
}

/** The gateway catalog file stat needed for mtime selection. */
interface GatewayCatalogFile {
  path: string
  mtimeMs: number
}

/** The store's last read, including why a non-live source was served. */
export interface AstudioCatalogReadResult extends AstudioCatalog {
  /** Set when a live source was unreadable and a fallback was served instead. */
  error: string | undefined
}

/**
 * The current catalog for the signed-in account. Every call re-reads disk, so
 * no cache can go stale; the file is small and reads are local-only.
 */
export class AstudioCatalogStore {
  /** The last non-live fallback reason, for diagnostics. */
  lastError: string | undefined

  constructor(private readonly options: AstudioCatalogStoreOptions) {}

  /** List the gateway catalog files, newest mtime first. */
  private async gatewayCatalogFiles(modelGatewayDir: string): Promise<GatewayCatalogFile[]> {
    let entries: string[]
    try {
      entries = await readdir(modelGatewayDir)
    } catch {
      return []
    }
    const files: GatewayCatalogFile[] = []
    for (const entry of entries) {
      if (!entry.startsWith(ASTUDIO_GATEWAY_CATALOG_PREFIX) || !entry.endsWith('.json')) continue
      const path = join(modelGatewayDir, entry)
      try {
        const info = await stat(path)
        if (!info.isFile()) continue
        files.push({ path, mtimeMs: info.mtimeMs })
      } catch {
        continue
      }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return files
  }

  /** Parse the server-synced roster file, when present. */
  private async readProviderCatalog(userDataDir: string): Promise<AstudioCatalogReadResult | undefined> {
    const path = join(userDataDir, ASTUDIO_PROVIDER_CATALOG_FILENAME)
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch {
      return undefined
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return undefined
    }
    return {
      models: providerModelsToInfos(parseProviderCatalog(parsed)),
      source: 'live',
      accountHash: undefined,
      gatewayRefreshedAt: undefined,
      fetchedAt: new Date().toISOString(),
      error: undefined,
    }
  }

  /** The built-in fallback roster as a read result. */
  private fallback(error: string | undefined): AstudioCatalogReadResult {
    return {
      models: [...FALLBACK_ASTUDIO_MODELS],
      source: 'builtin',
      accountHash: undefined,
      gatewayRefreshedAt: undefined,
      fetchedAt: new Date().toISOString(),
      error,
    }
  }

  /** Read the current catalog from disk. Never throws. */
  async current(): Promise<AstudioCatalogReadResult> {
    const userDataDir = this.options.resolveUserDataDir()
    if (userDataDir === undefined) {
      this.lastError = 'AStudio data root not found'
      return this.fallback(this.lastError)
    }

    const gatewayDir = join(userDataDir, 'model-gateway')
    const candidates = await this.gatewayCatalogFiles(gatewayDir)
    for (const candidate of candidates) {
      let content: string
      try {
        content = await readFile(candidate.path, 'utf8')
      } catch {
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch (error) {
        this.lastError = `gateway catalog is not valid JSON: ${(error as Error).message}`
        continue
      }
      const models = parseGatewayCatalog(parsed)
      if (models.length === 0) {
        this.lastError = 'gateway catalog contained no usable models'
        continue
      }
      this.lastError = undefined
      return {
        models,
        source: 'live',
        accountHash:
          typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? ((parsed as Record<string, unknown>)['accountHash'] as string | undefined) ?? undefined
            : undefined,
        gatewayRefreshedAt:
          typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? ((parsed as Record<string, unknown>)['refreshedAt'] as number | undefined) ?? undefined
            : undefined,
        fetchedAt: new Date().toISOString(),
        error: undefined,
      }
    }

    const provider = await this.readProviderCatalog(userDataDir)
    if (provider !== undefined && provider.models.length > 0) {
      this.lastError = undefined
      return provider
    }

    this.lastError =
      this.lastError ??
      (provider !== undefined && provider.models.length === 0
        ? 'provider catalog contained no usable models'
        : 'no on-disk catalog found')
    return this.fallback(this.lastError)
  }

  /** The identity string for one catalog (account hash when known). */
  identityOf(catalog: AstudioCatalog): string | undefined {
    return catalog.accountHash
  }

  /** The source label for UI/diagnostics. */
  sourceOf(catalog: AstudioCatalog): AstudioCatalogSource {
    return catalog.source
  }
}
