import type { ChecklistState, OnboardingDefinition } from './types'

// Emits the ticked ids in the order the steps are declared in the .onboarding.json file, so
// stored progress is stable rather than reordering itself as the user ticks around. Ids that no
// longer match a step are appended verbatim rather than dropped - a step-id rename and revert
// shouldn't silently destroy someone's saved progress.
export function orderedCompleted(definition: OnboardingDefinition, completed: string[]): string[] {
  const ticked = new Set(completed)
  const known = definition.steps.filter((step) => ticked.has(step.id)).map((step) => step.id)
  const knownIds = new Set(definition.steps.map((step) => step.id))
  const unknown = completed.filter((id) => !knownIds.has(id))
  return [...known, ...unknown]
}

export function isDone(state: ChecklistState, stepId: string): boolean {
  return state.completed.includes(stepId)
}

export function toggleStep(definition: OnboardingDefinition, state: ChecklistState, stepId: string, done: boolean): ChecklistState {
  const completed = done ? [...state.completed, stepId] : state.completed.filter((id) => id !== stepId)
  return { ...state, completed: orderedCompleted(definition, completed) }
}

export function doneCount(definition: OnboardingDefinition, state: ChecklistState): number {
  return definition.steps.filter((step) => state.completed.includes(step.id)).length
}
