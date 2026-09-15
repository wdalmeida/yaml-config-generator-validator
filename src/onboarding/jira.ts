// The base URL is a placeholder until the user replaces it. It's an `href` value that the user
// types and we persist, so the protocol check in jiraUrlFor is a security boundary, not
// hygiene: `javascript:alert(1)` pasted here would otherwise be a live XSS vector.
export const DEFAULT_JIRA_BASE_URL = 'https://your-org.atlassian.net'

export function jiraUrlFor(base: string, key: string): string | null {
  const trimmed = base.trim()
  // Blank or still the untouched placeholder: show the ticket key as plain text instead. A live
  // link to a domain nobody here controls is worse than no link at all.
  if (!trimmed || trimmed.replace(/\/+$/, '') === DEFAULT_JIRA_BASE_URL) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  return `${trimmed.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`
}
