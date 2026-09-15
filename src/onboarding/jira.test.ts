import { describe, expect, it } from 'vitest'
import { DEFAULT_JIRA_BASE_URL, jiraUrlFor } from './jira'

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
