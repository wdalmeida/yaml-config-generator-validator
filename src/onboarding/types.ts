import { z } from 'zod'

// Only http(s) may reach an href. Author-controlled here (these URLs come out of the checked-in
// .onboarding.json), but the check is free and it keeps the whole feature's URL handling to one
// rule - see jiraUrlFor in ./jira.ts, where the same rule guards a genuinely user-typed value.
const httpUrl = z
  .string()
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'must be an http(s) URL')

// One action the user can take on a step. A step carries as many or as few as it needs, so a
// Jira ticket is one option among several rather than a required field on every step - some
// steps are a doc to read, some a command to run, some a config file to fill in here.
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('docs'), url: httpUrl, label: z.string().min(1).optional() }),
  z.object({ type: z.literal('link'), url: httpUrl, label: z.string().min(1) }),
  z.object({ type: z.literal('jira'), key: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/, 'must look like ABC-123'), label: z.string().min(1).optional() }),
  z.object({ type: z.literal('command'), command: z.string().min(1), label: z.string().min(1).optional() }),
  z.object({ type: z.literal('config'), configId: z.string().min(1), label: z.string().min(1).optional() }),
])

const stepSchema = z.object({
  // Stable identifier: this is the value written into the checklist YAML, so renaming it
  // orphans a user's saved progress for that step.
  id: z.string().min(1),
  // Imperative mood, by authoring convention - "Commit config.yaml", not "Committing" or
  // "You should commit". Not machine-enforceable; see docs/adding-onboarding-steps.md.
  title: z.string().min(1),
  detail: z.string().min(1).optional(),
  optional: z.boolean().optional(),
  actions: z.array(actionSchema).default([]),
})

export const onboardingFileSchema = z
  .object({
    $schema: z.string().optional(),
    title: z.string().min(1),
    'x-onboarding-id': z.string().min(1),
    intro: z.string().min(1).optional(),
    steps: z.array(stepSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>()
    for (const step of file.steps) {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate step id: ${step.id}`, path: ['steps'] })
      }
      seen.add(step.id)
    }
  })

export type OnboardingAction = z.infer<typeof actionSchema>
export type OnboardingStep = z.infer<typeof stepSchema>
export type OnboardingFile = z.infer<typeof onboardingFileSchema>

// The runtime shape the UI consumes, with the x- vendor keys flattened away - the same
// relationship ConfigDefinition has to a *.schema.json document.
export interface OnboardingDefinition {
  id: string
  label: string
  intro?: string
  steps: OnboardingStep[]
}

export function onboardingDefinitionFromFile(file: OnboardingFile): OnboardingDefinition {
  return {
    id: file['x-onboarding-id'],
    label: file.title,
    intro: file.intro,
    steps: file.steps,
  }
}

export function requiredStepIds(definition: OnboardingDefinition): string[] {
  return definition.steps.filter((step) => !step.optional).map((step) => step.id)
}

// The saved checklist state. Nothing here is required: this is browser-local progress, not a
// file anyone commits, so its only job is to survive a reload and to be read back safely if
// what's in storage turns out to be junk. Completeness is measured by onboardingStatus.
export const checklistSchema = z.object({
  tenant: z.string().default(''),
  product: z.string().default(''),
  // Ticked step ids, not a map of id -> boolean. Shorter, and it makes every "unknown id"
  // question answer itself: rendering is driven by the step list in the .onboarding.json file,
  // so an id here that no longer exists simply isn't rendered, and a step added to that file
  // later is absent here and therefore unticked.
  completed: z.array(z.string()).default([]),
})

export type ChecklistState = z.infer<typeof checklistSchema>

export function emptyChecklist(): ChecklistState {
  return { tenant: '', product: '', completed: [] }
}
