import { describe, expect, it } from 'vitest'
import { consoleUrlFor, DEFAULT_CONSOLE_BASE_URL, DEFAULT_JIRA_BASE_URL, jiraUrlFor, safeBaseUrl } from './links'

describe('jiraUrlFor', () => {
  it('builds a browse URL from the base and the ticket key', () => {
    expect(jiraUrlFor('https://acme.atlassian.net', 'PLAT-1001')).toBe('https://acme.atlassian.net/browse/PLAT-1001')
  })

  it('normalises trailing slashes and surrounding whitespace', () => {
    expect(jiraUrlFor('  https://acme.atlassian.net///  ', 'PLAT-1')).toBe('https://acme.atlassian.net/browse/PLAT-1')
  })

  it('returns null for a blank base, so the key renders as plain text instead', () => {
    expect(jiraUrlFor('', 'PLAT-1')).toBeNull()
    expect(jiraUrlFor('   ', 'PLAT-1')).toBeNull()
  })

  it('returns null while the base is still the untouched placeholder', () => {
    // your-org.atlassian.net is a domain nobody here controls - a live link there is worse
    // than no link at all.
    expect(jiraUrlFor(DEFAULT_JIRA_BASE_URL, 'PLAT-1')).toBeNull()
    expect(jiraUrlFor(`${DEFAULT_JIRA_BASE_URL}/`, 'PLAT-1')).toBeNull()
  })

  it('returns null for a non-http(s) protocol - this value reaches an href', () => {
    expect(jiraUrlFor('javascript:alert(1)', 'PLAT-1')).toBeNull()
    expect(jiraUrlFor('data:text/html,<script>alert(1)</script>', 'PLAT-1')).toBeNull()
    expect(jiraUrlFor('file:///etc/passwd', 'PLAT-1')).toBeNull()
  })

  it('returns null for an unparseable base', () => {
    expect(jiraUrlFor('not a url', 'PLAT-1')).toBeNull()
  })

  it('encodes the ticket key', () => {
    expect(jiraUrlFor('https://acme.atlassian.net', 'A B/C')).toBe('https://acme.atlassian.net/browse/A%20B%2FC')
  })
})

describe('consoleUrlFor', () => {
  const base = 'https://console.apps.acme.com'

  it('joins the base and the step’s path', () => {
    expect(consoleUrlFor(base, '/k8s/cluster/projects')).toBe('https://console.apps.acme.com/k8s/cluster/projects')
  })

  it('accepts a path written with or without a leading slash', () => {
    expect(consoleUrlFor(base, 'k8s/cluster/projects')).toBe(consoleUrlFor(base, '/k8s/cluster/projects'))
    expect(consoleUrlFor(`${base}///`, '///k8s')).toBe('https://console.apps.acme.com/k8s')
  })

  it('falls back to the base itself for an empty path', () => {
    expect(consoleUrlFor(base, '   ')).toBe(base)
  })

  it('keeps slashes in the path rather than encoding them - it is a path, not a key', () => {
    expect(consoleUrlFor(base, '/a/b/c')).toBe('https://console.apps.acme.com/a/b/c')
  })

  it('returns null for blank, the placeholder, and a non-http(s) protocol', () => {
    expect(consoleUrlFor('', '/k8s')).toBeNull()
    expect(consoleUrlFor(DEFAULT_CONSOLE_BASE_URL, '/k8s')).toBeNull()
    expect(consoleUrlFor('javascript:alert(1)', '/k8s')).toBeNull()
    expect(consoleUrlFor('not a url', '/k8s')).toBeNull()
  })
})

describe('safeBaseUrl', () => {
  it('is the one place the protocol allowlist lives, for both base URLs', () => {
    expect(safeBaseUrl('https://a.example.com/', 'https://placeholder.example.com')).toBe('https://a.example.com')
    expect(safeBaseUrl('http://a.example.com', 'https://placeholder.example.com')).toBe('http://a.example.com')
    expect(safeBaseUrl('ftp://a.example.com', 'https://placeholder.example.com')).toBeNull()
  })
})
