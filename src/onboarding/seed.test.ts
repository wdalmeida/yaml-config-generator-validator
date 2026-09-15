import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ConfigDefinition, FieldDescriptor } from '../configs/types'
import { readPersistedState, writePersistedState } from '../lib/persisted-state'
import { describeSeedResults, seedConfigDrafts } from './seed'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// Fixtures rather than the real CONFIG_DEFINITIONS: today only tenant-config has a tenant or
// product property, so the multi-destination and wrong-field-type cases have no shipped schema
// to exercise them. That's what seedConfigDrafts' injectable `definitions` parameter is for.
function definitionOf(id: string, fields: FieldDescriptor[]): ConfigDefinition {
  return { id, label: id.toUpperCase(), defaultFilename: `${id}.yml`, schema: z.object({}), fields }
}

const textBoth = definitionOf('text-both', [
  { key: 'tenant', label: 'Tenant', type: 'text' },
  { key: 'product', label: 'Product', type: 'text' },
  { key: 'other', label: 'Other', type: 'text' },
])

const selectOrText = definitionOf('select-or-text', [
  { key: 'tenant', label: 'Tenant', type: 'select-or-text', options: ['acme', 'globex'], maxLength: 12 },
])

const unseedableTypes = definitionOf('unseedable', [
  { key: 'tenant', label: 'Tenant', type: 'select', options: ['acme', 'globex'] },
  { key: 'product', label: 'Product', type: 'toggle-text' },
])

const noMatch = definitionOf('no-match', [{ key: 'branch', label: 'Branch', type: 'text' }])

function draftFor(id: string) {
  return readPersistedState<Record<string, unknown> | null>(`draft:${id}`, null)
}

describe('seedConfigDrafts', () => {
  it('seeds matching text and select-or-text fields across every definition that has one', () => {
    const results = seedConfigDrafts({ tenant: 'globex', product: 'widgets' }, [textBoth, selectOrText])

    expect(results.map((r) => r.id)).toEqual(['text-both', 'select-or-text'])
    expect(draftFor('text-both')).toMatchObject({ tenant: 'globex', product: 'widgets' })
    expect(draftFor('select-or-text')).toMatchObject({ tenant: 'globex' })
  })

  it('skips a select-or-text already sitting on the value being seeded (its own first option)', () => {
    expect(seedConfigDrafts({ tenant: 'acme', product: '' }, [selectOrText])).toEqual([])
  })

  it('leaves every other key in the target draft alone', () => {
    writePersistedState('draft:text-both', { tenant: '', product: '', other: 'keep me' })

    seedConfigDrafts({ tenant: 'acme', product: 'widgets' }, [textBoth])

    expect(draftFor('text-both')).toEqual({ tenant: 'acme', product: 'widgets', other: 'keep me' })
  })

  it('skips select and toggle-text fields, where a plain string is not the whole value', () => {
    // A select renders a value outside its options as the *first* option while state holds
    // something else; a toggle-text would flip from absent to present. Both lie silently.
    expect(seedConfigDrafts({ tenant: 'acme', product: 'widgets' }, [unseedableTypes])).toEqual([])
    expect(draftFor('unseedable')).toBeNull()
  })

  it('skips definitions with no matching field, without materialising an empty draft for them', () => {
    expect(seedConfigDrafts({ tenant: 'acme', product: 'widgets' }, [noMatch])).toEqual([])
    expect(draftFor('no-match')).toBeNull()
  })

  it('skips blank values - blank means "not filled in yet", never "clear this everywhere"', () => {
    writePersistedState('draft:text-both', { tenant: 'existing', product: 'existing', other: '' })

    const results = seedConfigDrafts({ tenant: '   ', product: 'widgets' }, [textBoth])

    expect(results[0].seeded.map((f) => f.key)).toEqual(['product'])
    expect(draftFor('text-both')).toMatchObject({ tenant: 'existing' })
  })

  it('skips values that are already identical, so an unchanged type is not reported', () => {
    writePersistedState('draft:text-both', { tenant: 'acme', product: 'widgets', other: '' })

    expect(seedConfigDrafts({ tenant: 'acme', product: 'widgets' }, [textBoth])).toEqual([])
  })

  it('reports what it replaced when the user had actually typed there', () => {
    writePersistedState('draft:text-both', { tenant: 'acme', product: 'old-name', other: '' })

    const results = seedConfigDrafts({ tenant: 'acme', product: 'widgets' }, [textBoth])

    expect(results[0].seeded).toEqual([{ key: 'product', label: 'Product', value: 'widgets', replaced: 'old-name' }])
  })

  it('does not claim to have replaced a field default the user never chose', () => {
    // An untouched select-or-text draft already holds its first enum option ("acme"); saying
    // we replaced that on the very first seed would be a lie.
    writePersistedState('draft:select-or-text', { tenant: 'acme' })

    const results = seedConfigDrafts({ tenant: 'globex', product: '' }, [selectOrText])

    expect(results[0].seeded[0].replaced).toBeUndefined()
  })
})

describe('describeSeedResults', () => {
  it('says plainly when nothing matched, rather than implying it touched anything', () => {
    expect(describeSeedResults([])).toEqual(['Nothing to seed — no config type has a Tenant or Product field yet.'])
  })

  it('names the fields and the destination, and each replacement separately', () => {
    expect(
      describeSeedResults([
        {
          id: 'tenant-config',
          label: 'Tenant Config',
          seeded: [
            { key: 'tenant', label: 'Tenant', value: 'acme' },
            { key: 'product', label: 'Product', value: 'widgets', replaced: 'old-name' },
          ],
        },
      ]),
    ).toEqual(['Seeded Tenant, Product into Tenant Config.', 'Replaced Product in Tenant Config (was "old-name").'])
  })
})
