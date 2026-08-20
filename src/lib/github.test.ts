import { describe, expect, it } from 'vitest'
import { buildCreateFileUrl, buildEditFileUrl } from './github'

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
