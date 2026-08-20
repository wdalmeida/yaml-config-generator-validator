import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCreateFileUrl, buildEditFileUrl, checkFileExists } from './github'

const location = { owner: 'acme-co', repo: 'infra', branch: 'main', path: 'configs/tenant.yaml' }

describe('buildCreateFileUrl', () => {
  it('points at the /new page with filename and content prefilled', () => {
    const url = buildCreateFileUrl({ ...location, content: 'tenant: acme\n' })
    expect(url.startsWith('https://github.com/acme-co/infra/new/main?')).toBe(true)
    const params = new URL(url).searchParams
    expect(params.get('filename')).toBe('configs/tenant.yaml')
    expect(params.get('value')).toBe('tenant: acme\n')
  })
})

describe('buildEditFileUrl', () => {
  it('points at the /edit page for the existing file, with no content param', () => {
    const url = buildEditFileUrl(location)
    expect(url).toBe('https://github.com/acme-co/infra/edit/main/configs/tenant.yaml')
  })
})

describe('checkFileExists', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The contents URL always contains the repo URL as a substring, so route on the more
  // specific "/contents/" segment first.
  function stubFetch({ repoStatus, contentsStatus }: { repoStatus: number; contentsStatus?: number }) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const status = url.includes('/contents/') ? (contentsStatus ?? 500) : repoStatus
        return Promise.resolve({ status } as Response)
      }),
    )
  }

  it('reports "exists" when both the repo and the file path resolve', async () => {
    stubFetch({ repoStatus: 200, contentsStatus: 200 })
    await expect(checkFileExists(location)).resolves.toBe('exists')
  })

  it('reports "missing" when the repo is visible but the path 404s', async () => {
    stubFetch({ repoStatus: 200, contentsStatus: 404 })
    await expect(checkFileExists(location)).resolves.toBe('missing')
  })

  it('reports "unknown" (not "missing") when the repo itself 404s, e.g. a private repo', async () => {
    stubFetch({ repoStatus: 404 })
    await expect(checkFileExists(location)).resolves.toBe('unknown')
  })

  it('reports "unknown" on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    )
    await expect(checkFileExists(location)).resolves.toBe('unknown')
  })
})
