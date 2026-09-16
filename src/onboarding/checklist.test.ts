import { describe, expect, it } from 'vitest'
import { doneCount, isDone, orderedCompleted, toggleStep } from './checklist'
import { emptyChecklist, type OnboardingDefinition } from './types'

const definition: OnboardingDefinition = {
  id: 'test',
  label: 'Test',
  consoleLabel: 'Console',
  steps: [
    { id: 'first', title: 'Do the first thing', actions: [] },
    { id: 'second', title: 'Do the second thing', actions: [] },
    { id: 'third', title: 'Do the third thing', optional: true, actions: [] },
  ],
}

describe('orderedCompleted', () => {
  it('emits ticked ids in declared step order, not the order they were ticked', () => {
    expect(orderedCompleted(definition, ['third', 'first'])).toEqual(['first', 'third'])
  })

  it('preserves unrecognised ids by appending them, rather than dropping them', () => {
    // A step-id rename and revert shouldn't silently destroy a user's pasted-back progress.
    expect(orderedCompleted(definition, ['renamed-away', 'second'])).toEqual(['second', 'renamed-away'])
  })

  it('leaves an empty list empty', () => {
    expect(orderedCompleted(definition, [])).toEqual([])
  })
})

describe('toggleStep', () => {
  it('ticking adds the id and re-sorts into step order', () => {
    const state = toggleStep(definition, { ...emptyChecklist(), completed: ['second'] }, 'first', true)
    expect(state.completed).toEqual(['first', 'second'])
  })

  it('unticking removes only that id', () => {
    const state = toggleStep(definition, { ...emptyChecklist(), completed: ['first', 'second'] }, 'first', false)
    expect(state.completed).toEqual(['second'])
  })

  it('leaves tenant and product untouched', () => {
    const before = { tenant: 'acme', product: 'widgets', completed: [] }
    expect(toggleStep(definition, before, 'first', true)).toMatchObject({ tenant: 'acme', product: 'widgets' })
  })
})

describe('isDone / doneCount', () => {
  it('reports per-step and aggregate progress, ignoring unknown ids in the count', () => {
    const state = { ...emptyChecklist(), completed: ['first', 'gone'] }
    expect(isDone(state, 'first')).toBe(true)
    expect(isDone(state, 'second')).toBe(false)
    expect(doneCount(definition, state)).toBe(1)
  })
})

