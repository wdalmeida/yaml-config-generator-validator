// Two user-typed base URLs feed `href` attributes: the Jira host and the web console host.
// Both go through safeBaseUrl, so the protocol allowlist is written once - it is a security
// boundary, not hygiene, since `javascript:alert(1)` typed into either box would otherwise
// become a live link.
export const DEFAULT_JIRA_BASE_URL = 'https://your-org.atlassian.net'
export const DEFAULT_CONSOLE_BASE_URL = 'https://console.apps.example.com'

// Returns the usable origin+path of a base URL, or null when there isn't one yet. Null covers
// blank, the untouched placeholder (a domain nobody here controls - linking there is worse than
// not linking), anything unparseable, and any protocol other than http(s).
export function safeBaseUrl(base: string, placeholder: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed || trimmed === placeholder.replace(/\/+$/, '')) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  return trimmed
}

export function jiraUrlFor(base: string, key: string): string | null {
  const root = safeBaseUrl(base, DEFAULT_JIRA_BASE_URL)
  return root && `${root}/browse/${encodeURIComponent(key)}`
}

// `path` comes from the checklist file, not from the user, so it's joined rather than encoded -
// a console path is a real path with slashes in it. It's still normalised to start with exactly
// one slash so an author writing "k8s/…" or "/k8s/…" both work.
export function consoleUrlFor(base: string, path: string): string | null {
  const root = safeBaseUrl(base, DEFAULT_CONSOLE_BASE_URL)
  if (!root) return null
  const suffix = path.trim().replace(/^\/+/, '')
  return suffix ? `${root}/${suffix}` : root
}
