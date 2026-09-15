import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG_DEFINITIONS } from '../configs'
import { writePersistedState } from '../lib/persisted-state'
import { checklistKey, getOnboardingStatus, ONBOARDING_DEFINITIONS, readChecklist } from './index'
import { emptyChecklist, requiredStepIds } from './types'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

const configIds = new Set(CONFIG_DEFINITIONS.map((d) => d.id))
const definition = ONBOARDING_DEFINITIONS[0]

// This suite is the CI gate on the shipped *.onboarding.json files: a bad one throws at module
// load (the glob is parsed through Zod), and the invariants below cover what a per-file schema
// can't see - uniqueness across files, and whether a configId names a config type that exists.
describe('the shipped onboarding files', () => {
  it('discovers at least one checklist', () => {
    expect(ONBOARDING_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('has unique step ids within each file', () => {
    for (const def of ONBOARDING_DEFINITIONS) {
      const ids = def.steps.map((step) => step.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('has checklist ids that are unique and disjoint from the config type ids', () => {
    const ids = ONBOARDING_DEFINITIONS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(configIds.has(id)).toBe(false)
    }
  })

  it('only references config types that actually exist', () => {
    for (const def of ONBOARDING_DEFINITIONS) {
      for (const step of def.steps) {
        for (const action of step.actions) {
          if (action.type === 'config') expect(configIds.has(action.configId)).toBe(true)
        }
      }
    }
  })

  it('writes every step title in the imperative mood (starts with a capitalised verb, not a question)', () => {
    for (const def of ONBOARDING_DEFINITIONS) {
      for (const step of def.steps) {
        expect(step.title[0]).toBe(step.title[0].toUpperCase())
        expect(step.title.endsWith('?')).toBe(false)
        expect(step.title).not.toMatch(/^(You should|You need|Please)\b/)
      }
    }
  })
})

describe('readChecklist', () => {
  it('returns empty state when nothing is stored', () => {
    expect(readChecklist(definition)).toEqual(emptyChecklist())
  })

  it('falls back to empty state rather than throwing on stored junk', () => {
    writePersistedState(checklistKey(definition), { completed: 'not a list' })
    expect(readChecklist(definition)).toEqual(emptyChecklist())
  })
})

describe('getOnboardingStatus', () => {
  const required = requiredStepIds(definition)

  it('is empty with nothing typed and nothing ticked', () => {
    expect(getOnboardingStatus(definition, emptyChecklist())).toBe('empty')
  })

  it('is draft once anything is typed or ticked', () => {
    expect(getOnboardingStatus(definition, { ...emptyChecklist(), tenant: 'acme' })).toBe('draft')
    expect(getOnboardingStatus(definition, { ...emptyChecklist(), completed: [required[0]] })).toBe('draft')
  })

  it('is draft when every required step is ticked but the tenant and product are still blank', () => {
    expect(getOnboardingStatus(definition, { ...emptyChecklist(), completed: required })).toBe('draft')
  })

  it('is valid once tenant, product, and every required step are done', () => {
    expect(getOnboardingStatus(definition, { tenant: 'acme', product: 'widgets', completed: required })).toBe('valid')
  })

  it('does not require optional steps to be ticked', () => {
    const optional = definition.steps.filter((step) => step.optional)
    expect(optional.length).toBeGreaterThan(0)
    for (const step of optional) {
      expect(required).not.toContain(step.id)
    }
  })

  it('reads straight from localStorage when no state is passed, so a pill can be badged unmounted', () => {
    writePersistedState(checklistKey(definition), { tenant: 'acme', product: 'widgets', completed: required })
    expect(getOnboardingStatus(definition)).toBe('valid')
  })
})
