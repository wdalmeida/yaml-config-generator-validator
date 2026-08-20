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
