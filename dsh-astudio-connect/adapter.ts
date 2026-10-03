/**
 * The `astudio` pi-ai provider: the models from the AStudio desktop app's
 * own account, streamed straight to the AStudio model gateway with the
 * account's own bearer credential.
 *
 * Unlike the reference WorkBuddy route (which stands a loopback shim in
 * front of a non-OpenAI upstream), the AStudio gateway speaks the OpenAI
 * Responses API natively — `POST <baseUrl>/responses`,
 * `Authorization: Bearer <modelBearerToken>` — so the pi-ai provider points
 * at the gateway directly. The bearer credential is resolved per request
 * through the credential store, and pi-ai's auth plane stays inert: no
 * ambient discovery may manufacture or export a credential for this route.
 *
 * @module dsh-astudio-connect/adapter
 */

import {
  createProvider,
  type Api,
  type AuthContext,
  type CredentialStore,
  type Model,
  type ModelCost,
  type Provider,
  type ThinkingLevelMap,
} from '@earendil-works/pi-ai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AstudioCredentialStore } from './auth.ts'
import type { AstudioModelInfo } from './catalog.ts'

/** Provider route this bundle owns. */
export const ASTUDIO_PROVIDER = 'astudio'

/** The AStudio model gateway base URL (OpenAI Responses wire). */
export const ASTUDIO_BASE_URL = 'https://maas-api.cn-huabei-1.xf-yun.com/v1'

/** The default stream idle ceiling, matching dsh-llm-pi-ai's own default. */
export const ASTUDIO_STREAM_IDLE_TIMEOUT_MS = 300_000

/** Image-request budgets at the dsh-llm-pi-ai defaults. */
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImageBytes: 20_971_520,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,
} as const

/** No per-token pricing is knowable for an account quota; report zero. */
const NO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Inert pi-ai auth plane. The astudio route authenticates only through the
 * per-request `apiKey` override supplied by `resolveApiKey`, so pi-ai's own
 * credential lifecycle and ambient discovery must never manufacture a
 * credential for it. Every ambient question answers "nothing stored, nothing
 * set".
 */
const INERT_AUTH: { credentials: CredentialStore; authContext: AuthContext } = {
  credentials: {
    async read() {
      return undefined
    },
    async list() {
      return []
    },
    async modify() {
      throw new Error('dsh-astudio-connect: the astudio route has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() {
      return undefined
    },
    async fileExists() {
      return false
    },
  },
}

/**
 * Resolve one AStudio model's reasoning capability into pi-ai's
 * `thinkingLevelMap`: every pi-ai level maps to its AStudio wire spelling, or
 * `null` when the gateway's vocabulary does not include it. The offered set
 * is exactly the catalog's declared set — nothing more.
 */
export function reasoningFields(
  info: AstudioModelInfo,
): { reasoning: boolean; thinkingLevelMap?: ThinkingLevelMap } {
  if (!info.reasoning || info.supportedEfforts.length === 0) {
    return { reasoning: false }
  }
  const supported = new Set(info.supportedEfforts)
  const map = {
    off: supported.has('none') ? 'none' : null,
    // `minimal`/`low`/`medium`/`xhigh` are not in the gateway's effort
    // vocabulary (none|high|max), so no catalog set can ever contain them.
    minimal: null,
    low: null,
    medium: null,
    high: supported.has('high') ? 'high' : null,
    xhigh: null,
    max: supported.has('max') ? 'max' : null,
  } as ThinkingLevelMap
  return { reasoning: true, thinkingLevelMap: map }
}

/** Append the catalog's promotion badge to one model's display name. */
export function withBadge(name: string, info: AstudioModelInfo): string {
  if (info.badge === undefined || info.badge === '') return name
  return `${name} · ${info.badge}`
}

/** Constructor dependencies. */
export interface AstudioAdapterOptions {
  providerId?: string
  displayName?: string
  store: AstudioCredentialStore
  /**
   * The live catalog snapshot the adapter serves. Synchronous on purpose:
   * pi-ai's `Provider.getModels()` reads it on every model-list call, and the
   * plugin runtime replaces `models` after each disk refresh (then invalidates
   * so the provider snapshot rebuilds).
   */
  catalog: { models: AstudioModelInfo[] }
}

/** What {@link createAstudioAdapter} hands back. */
export interface AstudioAdapter {
  adapter: PiAiAdapter
  /** Rebuild the adapter's provider snapshot after a catalog update. */
  invalidate: () => void
}

/** Build one pi-ai model descriptor pointing at the AStudio gateway. */
export function toPiModel(info: AstudioModelInfo, providerId: string): Model<Api> {
  return {
    id: info.id,
    name: withBadge(info.name, info),
    api: 'openai-responses',
    provider: providerId,
    baseUrl: ASTUDIO_BASE_URL,
    input: [...info.input],
    ...reasoningFields(info),
    cost: NO_COST,
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens,
  } as unknown as Model<Api>
}

/**
 * Assemble the adapter. The provider's `getModels` reads the live catalog on
 * every read, so a catalog refresh or an account switch is served without
 * re-registering the route. The profile is constructed by hand rather than
 * through dsh-llm-pi-ai's internal `resolveProfiles()` — that helper is not
 * part of the package's public export surface.
 */
export function createAstudioAdapter(options: AstudioAdapterOptions): AstudioAdapter {
  const providerId = options.providerId ?? ASTUDIO_PROVIDER
  const displayName = options.displayName ?? 'AStudio'

  const buildModels = (): Model<Api>[] =>
    options.catalog.models.map(info => toPiModel(info, providerId))

  const base = createProvider({
    id: providerId,
    name: displayName,
    auth: {
      apiKey: {
        name: 'AStudio account bearer token',
        resolve: async ({ credential }) => {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'AStudio' }
        },
      },
    },
    models: [],
    api: openAIResponsesApi(),
  })

  // The live catalog drives both listing and resolution; static models stay
  // empty so nothing is ever served from a stale snapshot.
  const provider: Provider = {
    ...base,
    getModels: () => buildModels(),
  }

  const profile: ResolvedPiAiProviderProfile = {
    provider: providerId,
    displayName,
    streamIdleTimeoutMs: ASTUDIO_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-astudio-connect retryPolicy'),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    ...REQUEST_IMAGE_BUDGETS,
    piProvider: provider,
  }

  let profiles = new Map<string, ResolvedPiAiProviderProfile>([[providerId, profile]])

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    auth: INERT_AUTH,
    // Resolve the account's bearer token from the desktop session per request;
    // pi-ai sends it as `Authorization: Bearer <token>` to the gateway.
    resolveApiKey: async () => options.store.effectiveToken(),
  })

  return {
    adapter,
    invalidate: () => {
      profiles = new Map<string, ResolvedPiAiProviderProfile>([[providerId, profile]])
    },
  }
}
