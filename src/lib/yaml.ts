import YAML from 'yaml'
import type { ZodIssue, ZodType } from 'zod'

export function dataToYaml(data: unknown): string {
  return YAML.stringify(data)
}

export type ParseYamlResult<T> =
  | { success: true; data: T }
  | { success: false; yamlError: string }
  | { success: false; issues: ZodIssue[] }

export function parseYaml<T>(schema: ZodType<T>, source: string): ParseYamlResult<T> {
  let parsed: unknown
  try {
    parsed = YAML.parse(source)
  } catch (err) {
    return { success: false, yamlError: err instanceof Error ? err.message : 'Invalid YAML' }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    return { success: false, issues: result.error.issues }
  }
  return { success: true, data: result.data }
}

// Flattens a failed parse into the flat list of human-readable strings both YAML panels render.
// Lives here rather than in a component because it's a projection of ParseYamlResult, which
// this module owns, and both ConfigWorkspace and OnboardingWorkspace need exactly this shape.
export function yamlIssueMessages(parsed: ParseYamlResult<unknown>): string[] {
  if (parsed.success) return []
  return 'yamlError' in parsed
    ? [`YAML syntax error: ${parsed.yamlError}`]
    : parsed.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}
