import { describe, expect, it } from 'vitest'
import {
  parseGatewayCatalog,
  parseProviderCatalog,
  providerModelsToInfos,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  FALLBACK_ASTUDIO_MODELS,
} from '../src/catalog.ts'

describe('parseGatewayCatalog', () => {
  it('parses a full gateway catalog', () => {
    const raw = {
      version: 1,
      accountHash: 'abc123',
      refreshedAt: 1700000000000,
      builtins: {
        models: [
          {
            slug: 'spark-x2.5',
            display_name: 'Spark-X2.5',
            context_window: 262144,
            max_output_tokens: 256000,
            supported_reasoning_levels: [
              { effort: 'none', description: 'No reasoning' },
              { effort: 'high', description: 'Deep reasoning' },
            ],
            input_modalities: ['text'],
            badge: { text: { 'zh-CN': '专享特惠', en: 'Promotion' } },
          },
          {
            slug: 'xopglm52',
            display_name: 'GLM-5.2',
            context_window: 1000000,
            max_output_tokens: 128000,
            supported_reasoning_levels: [
              { effort: 'none' },
              { effort: 'high' },
              { effort: 'max' },
            ],
            input_modalities: ['text', 'image'],
          },
        ],
      },
    }

    const models = parseGatewayCatalog(raw)
    expect(models).toHaveLength(2)

    expect(models[0]).toEqual({
      id: 'spark-x2.5',
      name: 'Spark-X2.5',
      contextWindow: 262144,
      maxTokens: 256000,
      reasoning: true,
      supportedEfforts: ['none', 'high'],
      badge: '专享特惠',
      input: ['text'],
    })

    expect(models[1]).toEqual({
      id: 'xopglm52',
      name: 'GLM-5.2',
      contextWindow: 1000000,
      maxTokens: 128000,
      reasoning: true,
      supportedEfforts: ['none', 'high', 'max'],
      badge: undefined,
      input: ['text', 'image'],
    })
  })

  it('skips rows without slug or display_name', () => {
    const raw = {
      builtins: {
        models: [
          { display_name: 'No slug', context_window: 100 },
          { slug: 'no-name' },
          { slug: 'valid', display_name: 'Valid' },
        ],
      },
    }
    const models = parseGatewayCatalog(raw)
    expect(models).toHaveLength(1)
    expect(models[0]!.id).toBe('valid')
  })

  it('uses defaults for missing capacity fields', () => {
    const raw = {
      builtins: {
        models: [
          {
            slug: 'minimal',
            display_name: 'Minimal',
            // no context_window or max_output_tokens
          },
        ],
      },
    }
    const models = parseGatewayCatalog(raw)
    expect(models).toHaveLength(1)
    expect(models[0]!.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(models[0]!.maxTokens).toBe(DEFAULT_MAX_TOKENS)
  })

  it('treats non-reasoning models correctly', () => {
    const raw = {
      builtins: {
        models: [
          {
            slug: 'no-reasoning',
            display_name: 'No Reasoning',
            supported_reasoning_levels: [],
            input_modalities: ['text'],
          },
        ],
      },
    }
    const models = parseGatewayCatalog(raw)
    expect(models).toHaveLength(1)
    expect(models[0]!.reasoning).toBe(false)
    expect(models[0]!.supportedEfforts).toEqual([])
  })

  it('returns empty array for malformed input', () => {
    expect(parseGatewayCatalog(null)).toEqual([])
    expect(parseGatewayCatalog({})).toEqual([])
    expect(parseGatewayCatalog({ builtins: {} })).toEqual([])
    expect(parseGatewayCatalog({ builtins: { models: 'not-an-array' } })).toEqual([])
  })

  it('handles missing input_modalities gracefully', () => {
    const raw = {
      builtins: {
        models: [
          {
            slug: 'no-modalities',
            display_name: 'No Modalities',
          },
        ],
      },
    }
    const models = parseGatewayCatalog(raw)
    expect(models).toHaveLength(1)
    expect(models[0]!.input).toEqual(['text'])
  })

  it('prefers zh-CN badge text over en', () => {
    const raw = {
      builtins: {
        models: [
          {
            slug: 'badge-test',
            display_name: 'Badge Test',
            badge: { text: { 'zh-CN': '中文', en: 'English' } },
          },
        ],
      },
    }
    const models = parseGatewayCatalog(raw)
    expect(models[0]!.badge).toBe('中文')
  })
})

describe('parseProviderCatalog', () => {
  it('parses a provider catalog roster', () => {
    const raw = {
      models: [
        {
          slug: 'model-a',
          name: 'Model A',
          supportedReasoningEfforts: [{ value: 'none' }, { value: 'high' }],
        },
        {
          slug: 'model-b',
          name: 'Model B',
          supportedReasoningEfforts: ['none', 'max'],
        },
      ],
    }

    const models = parseProviderCatalog(raw)
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual({
      slug: 'model-a',
      name: 'Model A',
      reasoningEfforts: ['none', 'high'],
      badge: undefined,
    })
    expect(models[1]).toEqual({
      slug: 'model-b',
      name: 'Model B',
      reasoningEfforts: ['none', 'max'],
      badge: undefined,
    })
  })

  it('skips rows without slug or name', () => {
    const raw = {
      models: [
        { name: 'No slug' },
        { slug: 'no-name' },
        { slug: 'valid', name: 'Valid' },
      ],
    }
    const models = parseProviderCatalog(raw)
    expect(models).toHaveLength(1)
    expect(models[0]!.slug).toBe('valid')
  })

  it('returns empty array for malformed input', () => {
    expect(parseProviderCatalog(null)).toEqual([])
    expect(parseProviderCatalog({})).toEqual([])
    expect(parseProviderCatalog({ models: 'not-an-array' })).toEqual([])
  })
})

describe('providerModelsToInfos', () => {
  it('converts provider models to catalog infos with default capacities', () => {
    const models = parseProviderCatalog({
      models: [
        {
          slug: 'model-a',
          name: 'Model A',
          supportedReasoningEfforts: [{ value: 'none' }],
        },
      ],
    })

    const infos = providerModelsToInfos(models)
    expect(infos).toHaveLength(1)
    expect(infos[0]).toEqual({
      id: 'model-a',
      name: 'Model A',
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      reasoning: true,
      supportedEfforts: ['none'],
      badge: undefined,
      input: ['text'],
    })
  })

  it('marks non-reasoning models correctly', () => {
    const models = parseProviderCatalog({
      models: [
        {
          slug: 'model-b',
          name: 'Model B',
          supportedReasoningEfforts: [],
        },
      ],
    })

    const infos = providerModelsToInfos(models)
    expect(infos[0]!.reasoning).toBe(false)
    expect(infos[0]!.supportedEfforts).toEqual([])
  })
})

describe('FALLBACK_ASTUDIO_MODELS', () => {
  it('contains at least 5 models', () => {
    expect(FALLBACK_ASTUDIO_MODELS.length).toBeGreaterThanOrEqual(5)
  })

  it('all models have valid fields', () => {
    for (const model of FALLBACK_ASTUDIO_MODELS) {
      expect(model.id).toBeTruthy()
      expect(model.name).toBeTruthy()
      expect(model.contextWindow).toBeGreaterThan(0)
      expect(model.maxTokens).toBeGreaterThan(0)
      expect(model.input.length).toBeGreaterThan(0)
    }
  })

  it('includes known model slugs', () => {
    const slugs = FALLBACK_ASTUDIO_MODELS.map(m => m.id)
    expect(slugs).toContain('astronclaw-auto')
    expect(slugs).toContain('xopglm52')
    expect(slugs).toContain('xopdeepseekv4pro0813')
  })
})
