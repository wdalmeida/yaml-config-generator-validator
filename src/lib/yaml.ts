import YAML from 'yaml'
import type { ZodIssue } from 'zod'
import { configSchema, type Config } from '../schema/config'

export function configToYaml(config: Config): string {
  return YAML.stringify(config)
}

export type ParseYamlConfigResult =
  | { success: true; data: Config }
  | { success: false; yamlError: string }
  | { success: false; issues: ZodIssue[] }

export function parseYamlConfig(source: string): ParseYamlConfigResult {
  let parsed: unknown
  try {
    parsed = YAML.parse(source)
  } catch (err) {
    return { success: false, yamlError: err instanceof Error ? err.message : 'Invalid YAML' }
  }

  const result = configSchema.safeParse(parsed)
  if (!result.success) {
    return { success: false, issues: result.error.issues }
  }
  return { success: true, data: result.data }
}
