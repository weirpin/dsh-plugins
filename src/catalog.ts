/**
 * The AStudio model catalog: parse the desktop app's on-disk catalogs into a
 * flat, pi-ai-ready model list, with a compiled-in fallback roster so the
 * provider group still appears before the first successful catalog read.
 *
 * Two on-disk shapes are understood:
 *
 * - `<userdata>/model-gateway/catalog-<accountHash>.json` — the app's own
 *   per-account gateway catalog (context windows, reasoning levels, badges,
 *   modalities). Primary source.
 * - `<userdata>/provider-model-catalog-v1.json` — the account-scoped model
 *   roster the server syncs at startup. Secondary source.
 *
 * @module dsh-astudio-connect/catalog
 */

/** One catalog model, in the spelling the model gateway speaks on the wire. */
export interface AstudioModelInfo {
  /** Wire model id (the gateway slug), sent verbatim in request bodies. */
  id: string
  /** Human-readable display name. */
  name: string
  contextWindow: number
  maxTokens: number
  /** Whether the upstream declares a reasoning effort vocabulary. */
  reasoning: boolean
  /** The wire spellings of the declared effort levels (e.g. `none|high|max`). */
  supportedEfforts: readonly string[]
  /** Promotion badge text (upstream's own spelling), when declared. */
  badge: string | undefined
  /** Declared input modalities. */
  input: ReadonlyArray<'text' | 'image'>
}

/** Where the catalog currently served by {@link AstudioCatalogStore} came from. */
export type AstudioCatalogSource = 'live' | 'saved' | 'builtin'

/** The catalog the provider group currently serves. */
export interface AstudioCatalog {
  models: AstudioModelInfo[]
  source: AstudioCatalogSource
  /** The gateway catalog's own account hash, when parsed from one. */
  accountHash: string | undefined
  /** Gateway catalog refresh time (epoch ms), when parsed from one. */
  gatewayRefreshedAt: number | undefined
  /** When this catalog was read, ISO timestamp. */
  fetchedAt: string
}

/** Context capacity assumed for a catalog row that does not size one. */
export const DEFAULT_CONTEXT_WINDOW = 262_144

/** Output capability assumed for a catalog row that does not size one. */
export const DEFAULT_MAX_TOKENS = 32_768

/** Parse one gateway catalog level entry (`{effort, description}`) into a wire effort. */
function gatewayEffort(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const effort = (value as Record<string, unknown>)['effort']
  return typeof effort === 'string' && effort.trim().length > 0 ? effort.trim() : undefined
}

/** Localized badge text, preferring the desktop app's own UI language. */
function badgeText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const text = (value as Record<string, unknown>)['text']
  if (typeof text !== 'object' || text === null) return undefined
  const record = text as Record<string, unknown>
  for (const key of ['zh-CN', 'zh', 'en']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return undefined
}

/**
 * Parse the gateway catalog (`<userdata>/model-gateway/catalog-<hash>.json`).
 * Unknown rows are skipped rather than failing the whole catalog: the gateway
 * ships rows for plans the account does not hold, and the app itself filters
 * them by account at the gateway boundary.
 */
export function parseGatewayCatalog(raw: unknown): AstudioModelInfo[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const root = raw as Record<string, unknown>
  const builtins = root['builtins']
  if (typeof builtins !== 'object' || builtins === null) return []
  const models = (builtins as Record<string, unknown>)['models']
  if (!Array.isArray(models)) return []

  const out: AstudioModelInfo[] = []
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const id = typeof row['slug'] === 'string' ? (row['slug'] as string).trim() : ''
    const name = typeof row['display_name'] === 'string' ? (row['display_name'] as string).trim() : ''
    if (id === '' || name === '') continue

    const levels = Array.isArray(row['supported_reasoning_levels'])
      ? (row['supported_reasoning_levels'] as unknown[])
          .map(gatewayEffort)
          .filter((value): value is string => value !== undefined)
      : []
    const input: ReadonlyArray<'text' | 'image'> = Array.isArray(row['input_modalities'])
      ? (row['input_modalities'] as unknown[]).filter(
          (value): value is 'text' | 'image' => value === 'text' || value === 'image',
        )
      : ['text']

    out.push({
      id,
      name,
      contextWindow:
        typeof row['context_window'] === 'number' && (row['context_window'] as number) > 0
          ? (row['context_window'] as number)
          : DEFAULT_CONTEXT_WINDOW,
      maxTokens:
        typeof row['max_output_tokens'] === 'number' && (row['max_output_tokens'] as number) > 0
          ? (row['max_output_tokens'] as number)
          : DEFAULT_MAX_TOKENS,
      reasoning: levels.length > 0,
      supportedEfforts: levels,
      badge: badgeText(row['badge']),
      input,
    })
  }
  return out
}

/** The account-scoped roster synced by the server at startup. */
export interface ProviderCatalogModel {
  slug: string
  name: string
  /** The server's own reasoning vocabulary, e.g. `none|high|max`. */
  reasoningEfforts: readonly string[]
  badge: string | undefined
}

/**
 * Parse `provider-model-catalog-v1.json` into model infos. The server roster
 * carries no capacity facts, so every row lands on the seam's documented
 * defaults and the gateway catalog (when readable) stays authoritative.
 */
export function parseProviderCatalog(raw: unknown): ProviderCatalogModel[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const models = (raw as Record<string, unknown>)['models']
  if (!Array.isArray(models)) return []
  const out: ProviderCatalogModel[] = []
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const slug = typeof row['slug'] === 'string' ? (row['slug'] as string).trim() : ''
    const name = typeof row['name'] === 'string' ? (row['name'] as string).trim() : ''
    if (slug === '' || name === '') continue
    const efforts = Array.isArray(row['supportedReasoningEfforts'])
      ? (row['supportedReasoningEfforts'] as unknown[])
          .map(level =>
            typeof level === 'object' && level !== null
              ? typeof (level as Record<string, unknown>)['value'] === 'string'
                ? ((level as Record<string, unknown>)['value'] as string).trim()
                : undefined
              : typeof level === 'string'
                ? level.trim()
                : undefined,
          )
          .filter((value): value is string => value !== undefined && value !== '')
      : []
    out.push({ slug, name, reasoningEfforts: efforts, badge: badgeText(row['badge']) })
  }
  return out
}

/** Convert the server roster into catalog infos (default capacities). */
export function providerModelsToInfos(models: readonly ProviderCatalogModel[]): AstudioModelInfo[] {
  return models.map(model => ({
    id: model.slug,
    name: model.name,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    reasoning: model.reasoningEfforts.length > 0,
    supportedEfforts: model.reasoningEfforts,
    badge: model.badge,
    input: ['text'] as const,
  }))
}

/**
 * Compiled-in fallback roster, a snapshot of the gateway catalog this plugin
 * was built against. Used only when no on-disk catalog is readable so the
 * provider group still appears; rows the account does not hold will fail at
 * the gateway, exactly like the reference plugin's built-in fallback.
 */
export const FALLBACK_ASTUDIO_MODELS: readonly AstudioModelInfo[] = [
  {
    id: 'astronclaw-auto',
    name: 'Auto',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
    supportedEfforts: ['none', 'high'],
    badge: undefined,
    input: ['text'],
  },
  {
    id: 'spark-x2.5',
    name: 'Spark-X2.5',
    contextWindow: 262_144,
    maxTokens: 256_000,
    reasoning: true,
    supportedEfforts: ['none', 'high'],
    badge: '专享特惠',
    input: ['text'],
  },
  {
    id: 'xopglm52',
    name: 'GLM-5.2',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    reasoning: true,
    supportedEfforts: ['none', 'high', 'max'],
    badge: undefined,
    input: ['text'],
  },
  {
    id: 'xopdsv4flash0731in',
    name: 'DeepSeek-V4-Flash',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
    supportedEfforts: ['none', 'high', 'max'],
    badge: undefined,
    input: ['text'],
  },
  {
    id: 'xopdeepseekv4pro0813',
    name: 'DeepSeek-V4-Pro',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
    supportedEfforts: ['none', 'high', 'max'],
    badge: undefined,
    input: ['text'],
  },
]
