import type { DraftStatus } from '../configs/types'
import { readPersistedState } from '../lib/persisted-state'
import {
  checklistSchema,
  emptyChecklist,
  onboardingDefinitionFromFile,
  onboardingFileSchema,
  requiredStepIds,
  type ChecklistState,
  type OnboardingDefinition,
} from './types'

// Every *.onboarding.json file here becomes a checklist automatically - dropping one in is the
// whole integration, exactly as it is for a *.schema.json config type. `eager: true` bundles
// them at build time; this is a static site with no server to fetch them from at runtime.
const onboardingModules = import.meta.glob('./*.onboarding.json', { eager: true }) as Record<string, { default: unknown }>

// Parsed, not cast. A malformed checklist file fails loudly here rather than half-rendering a
// broken step list; scripts/validate-json-schemas.mjs catches the same mistakes in CI first.
export const ONBOARDING_DEFINITIONS: OnboardingDefinition[] = Object.entries(onboardingModules)
  .map(([path, module]) => {
    const parsed = onboardingFileSchema.safeParse(module.default)
    if (!parsed.success) {
      throw new Error(`Invalid onboarding file ${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    }
    return onboardingDefinitionFromFile(parsed.data)
  })
  .sort((a, b) => a.id.localeCompare(b.id))

export function checklistKey(definition: OnboardingDefinition): string {
  return `onboarding:${definition.id}`
}

export function readChecklist(definition: OnboardingDefinition): ChecklistState {
  const stored = readPersistedState<unknown>(checklistKey(definition), () => emptyChecklist())
  const parsed = checklistSchema.safeParse(stored)
  return parsed.success ? parsed.data : emptyChecklist()
}

// Same contract as getDraftStatus: read straight from localStorage without mounting the
// workspace, so the pill can be badged even while another type is open. Takes the state as a
// parameter so it stays a pure function in tests.
//
// Precedence mirrors getDraftStatus's (valid first), so the sixth dot promises the same thing
// as the other five: green means "this is finished", not "this has something in it".
export function getOnboardingStatus(definition: OnboardingDefinition, state: ChecklistState = readChecklist(definition)): DraftStatus {
  const identified = Boolean(state.tenant.trim()) && Boolean(state.product.trim())
  const ticked = new Set(state.completed)
  if (identified && requiredStepIds(definition).every((id) => ticked.has(id))) return 'valid'
  return identified || ticked.size > 0 || state.tenant.trim() || state.product.trim() ? 'draft' : 'empty'
}

export type {
  ChecklistState,
  OnboardingAction,
  OnboardingDefinition,
  OnboardingPathVariant,
  OnboardingStep,
  OnboardingUiPath,
  StepPath,
} from './types'
export { emptyChecklist, checklistSchema, requiredStepIds, STEP_PATHS } from './types'
