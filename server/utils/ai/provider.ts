// AI provider boundary (plan sections 5, 6, 10; Milestone 5).
//
// This is the ONLY module in the codebase that talks to an AI provider. All
// provider imports (`ai`, `@ai-sdk/openai`) live here and nowhere else, so the
// deterministic pipeline and the UI stay completely provider-independent and no
// AI key can leak into the browser bundle.
//
// The `BehaviorAnalyzer` interface lets callers (and tests) inject a fake
// analyzer, so the whole pipeline can be exercised with no network access. The
// default implementation uses the Vercel AI SDK `generateObject` constrained by
// the strict Zod schema, with the provider/key read from SERVER-ONLY
// runtimeConfig (aiApiKey / aiGatewayBaseUrl).

import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { DeterministicChangeMap } from '../analysis/change-map'
import type { EvidenceManifestEntry } from '../analysis/evidence-registry'
import type { BehaviorAnalysisOutput } from './schemas'
import { behaviorAnalysisSchema } from './schemas'
import { BEHAVIOR_SYSTEM_PROMPT, buildBehaviorPrompt } from './prompts'

/** Inputs to a behavioral-change analysis pass. */
export interface BehaviorAnalyzerInput {
  manifest: EvidenceManifestEntry[]
  changeMap: DeterministicChangeMap
}

/** Result of a behavioral-change analysis pass. */
export interface BehaviorAnalyzerResult {
  output: BehaviorAnalysisOutput
  /** The concrete model identifier used, persisted on the run for provenance. */
  modelId: string
}

/**
 * Typed seam for the behavioral-change pass. The default implementation calls a
 * real provider; tests inject a fake that returns a fixed object with no
 * network.
 */
export interface BehaviorAnalyzer {
  analyze(input: BehaviorAnalyzerInput): Promise<BehaviorAnalyzerResult>
}

/** Default model id when none is configured. */
export const DEFAULT_MODEL_ID = 'gpt-4o-mini'

export interface OpenAiBehaviorAnalyzerOptions {
  apiKey: string
  /** Optional AI Gateway / compatible base URL. */
  baseURL?: string
  /** Model id to request; defaults to DEFAULT_MODEL_ID. */
  modelId?: string
}

/**
 * Default provider-backed analyzer. Uses `generateObject` with the strict Zod
 * schema so provider output that adds unknown fields or wrong types is rejected
 * at the boundary before it ever reaches validation/persistence.
 */
export class OpenAiBehaviorAnalyzer implements BehaviorAnalyzer {
  private readonly modelId: string
  private readonly provider: ReturnType<typeof createOpenAI>

  constructor(options: OpenAiBehaviorAnalyzerOptions) {
    if (!options.apiKey) {
      throw new Error('OpenAiBehaviorAnalyzer requires an API key (server-only NUXT_AI_API_KEY).')
    }
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID
    this.provider = createOpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    })
  }

  async analyze(input: BehaviorAnalyzerInput): Promise<BehaviorAnalyzerResult> {
    const { object } = await generateObject({
      model: this.provider(this.modelId),
      schema: behaviorAnalysisSchema,
      system: BEHAVIOR_SYSTEM_PROMPT,
      prompt: buildBehaviorPrompt({ manifest: input.manifest, changeMap: input.changeMap }),
    })
    return { output: object, modelId: this.modelId }
  }
}

/**
 * Build the default analyzer from SERVER-ONLY runtimeConfig. Throws when the
 * key is missing so the caller can surface a recoverable failure rather than
 * calling a provider with no credentials.
 */
export function createDefaultBehaviorAnalyzer(): BehaviorAnalyzer {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey as string
  const baseURL = (config.aiGatewayBaseUrl as string) || undefined
  return new OpenAiBehaviorAnalyzer({ apiKey, baseURL })
}
