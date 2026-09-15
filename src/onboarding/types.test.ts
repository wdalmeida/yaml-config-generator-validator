import { describe, expect, it } from 'vitest'
import { checklistSchema, onboardingFileSchema } from './types'

const minimal = {
  title: 'Onboarding',
  'x-onboarding-id': 'onboarding',
  steps: [{ id: 'first', title: 'Do the thing' }],
}

function withSteps(steps: unknown[]) {
  return onboardingFileSchema.safeParse({ ...minimal, steps })
}

describe('onboardingFileSchema', () => {
  it('accepts a minimal file and defaults actions to an empty list', () => {
    const parsed = onboardingFileSchema.safeParse(minimal)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.steps[0].actions).toEqual([])
  })

  it('rejects a file missing its id, its title, or its steps', () => {
    expect(onboardingFileSchema.safeParse({ ...minimal, 'x-onboarding-id': undefined }).success).toBe(false)
    expect(onboardingFileSchema.safeParse({ ...minimal, title: undefined }).success).toBe(false)
    expect(onboardingFileSchema.safeParse({ ...minimal, steps: [] }).success).toBe(false)
  })

  it('rejects a step with no id or no title', () => {
    expect(withSteps([{ title: 'No id' }]).success).toBe(false)
    expect(withSteps([{ id: 'no-title' }]).success).toBe(false)
  })

  it('rejects duplicate step ids, since the id is the key saved progress hangs off', () => {
    const parsed = withSteps([
      { id: 'same', title: 'One' },
      { id: 'same', title: 'Two' },
    ])
    expect(parsed.success).toBe(false)
    expect(!parsed.success && parsed.error.issues[0].message).toMatch(/duplicate step id: same/)
  })

  describe('actions', () => {
    it('accepts every action type', () => {
      const parsed = withSteps([
        {
          id: 'first',
          title: 'Do the thing',
          actions: [
            { type: 'docs', url: 'https://example.com/docs' },
            { type: 'link', label: 'Portal', url: 'https://example.com' },
            { type: 'jira', key: 'PLAT-1001' },
            { type: 'command', command: 'just ci' },
            { type: 'config', configId: 'tenant-config' },
          ],
        },
      ])
      expect(parsed.success).toBe(true)
    })

    it('rejects a non-http(s) url - these values reach an href', () => {
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'docs', url: 'javascript:alert(1)' }] }]).success).toBe(false)
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'docs', url: 'not a url' }] }]).success).toBe(false)
    })

    it('rejects a jira key that does not look like a ticket key', () => {
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'jira', key: 'plat-1' }] }]).success).toBe(false)
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'jira', key: 'PLAT' }] }]).success).toBe(false)
    })

    it('rejects an action missing its own required key', () => {
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'link', url: 'https://example.com' }] }]).success).toBe(false)
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'command' }] }]).success).toBe(false)
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'config' }] }]).success).toBe(false)
      expect(withSteps([{ id: 'a', title: 'A', actions: [{ type: 'nope' }] }]).success).toBe(false)
    })
  })
})

describe('checklistSchema', () => {
  it('defaults every field, so an empty document is still valid state', () => {
    const parsed = checklistSchema.safeParse({})
    expect(parsed.success && parsed.data).toEqual({ tenant: '', product: '', completed: [] })
  })

  it('rejects a completed list that is not a list of strings', () => {
    expect(checklistSchema.safeParse({ completed: 3 }).success).toBe(false)
    expect(checklistSchema.safeParse({ completed: [1, 2] }).success).toBe(false)
  })

  it('rejects a non-object root', () => {
    expect(checklistSchema.safeParse('nope').success).toBe(false)
  })
})
