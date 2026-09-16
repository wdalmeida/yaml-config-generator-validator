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

// A step usually has two ways to do it. They're kept as separate blocks rather than one mixed
// action list because the user picks a lane up front (see the CLI/UI switch in
// OnboardingWorkspace) and sees only that lane's instructions - mixing "run this command" and
// "click this button" in one list is exactly what that switch exists to stop.
// .strict() throughout this file, matching the meta-schema's `additionalProperties: false`:
// these are hand-authored data files, so a typo'd or misplaced key is a mistake to report, not
// an extra to quietly drop. (Zod's default - stripping - is right for parsing a config the user
// pasted, which is why zodFromObjectProperties on the config side stays non-strict.)
const pathVariantSchema = z
  .object({
    // An ordered sub-list: the actual clicks, or the actual sequence of commands. Rendered as
    // an <ol> under the step title.
    instructions: z.array(z.string().min(1)).default([]),
    actions: z.array(actionSchema).default([]),
  })
  .strict()

const uiPathSchema = pathVariantSchema
  .extend({
    // Appended to the console base URL the user types once (see consoleUrlFor). A path, not a
    // full URL, so one checklist works against any cluster's console.
    console: z.string().min(1).optional(),
  })
  .strict()

const stepSchema = z.object({
  // Stable identifier: this is the value written into the checklist YAML, so renaming it
  // orphans a user's saved progress for that step.
  id: z.string().min(1),
  // Imperative mood, by authoring convention - "Commit config.yaml", not "Committing" or
  // "You should commit". Not machine-enforceable; see docs/adding-onboarding-steps.md.
  title: z.string().min(1),
  detail: z.string().min(1).optional(),
  optional: z.boolean().optional(),
  // Path-independent: documentation and tickets are the same whichever lane you're in.
  actions: z.array(actionSchema).default([]),
  cli: pathVariantSchema.optional(),
  ui: uiPathSchema.optional(),
})
  .strict()

export const onboardingFileSchema = z
  .object({
    $schema: z.string().optional(),
    title: z.string().min(1),
    'x-onboarding-id': z.string().min(1),
    intro: z.string().min(1).optional(),
    // What this org calls its web console, e.g. "OpenShift console". Labels the console *link*
    // only - not the UI/CLI switch, which stays generic because a step's UI route is often some
    // other interface entirely (a Jira form, an access portal). One label for the whole
    // checklist rather than a per-step one, since every ui.console path points at the same host.
    'x-console-label': z.string().min(1).optional(),
    steps: z.array(stepSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>()
    for (const step of file.steps) {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate step id: ${step.id}`, path: ['steps'] })
      }
      seen.add(step.id)

      // A command is by definition the CLI route, so one in the path-independent list would be
      // shown to a reader who explicitly asked not to see commands - which is the one thing the
      // CLI/UI switch exists to prevent.
      if (step.actions.some((action) => action.type === 'command')) {
        ctx.addIssue({
          code: 'custom',
          message: `step "${step.id}": a command action belongs in \`cli.actions\`, not in the step's own \`actions\``,
          path: ['steps'],
        })
      }
    }
  })

export type OnboardingAction = z.infer<typeof actionSchema>
export type OnboardingPathVariant = z.infer<typeof pathVariantSchema>
export type OnboardingUiPath = z.infer<typeof uiPathSchema>

// Which set of instructions a reader wants. Persisted, because it's a property of the person,
// not of the checklist.
export type StepPath = 'cli' | 'ui'
export const STEP_PATHS: StepPath[] = ['cli', 'ui']
export type OnboardingStep = z.infer<typeof stepSchema>
export type OnboardingFile = z.infer<typeof onboardingFileSchema>

// The runtime shape the UI consumes, with the x- vendor keys flattened away - the same
// relationship ConfigDefinition has to a *.schema.json document.
export interface OnboardingDefinition {
  id: string
  label: string
  intro?: string
  consoleLabel: string
  steps: OnboardingStep[]
}

export function onboardingDefinitionFromFile(file: OnboardingFile): OnboardingDefinition {
  return {
    id: file['x-onboarding-id'],
    label: file.title,
    intro: file.intro,
    consoleLabel: file['x-console-label'] ?? 'Console',
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
