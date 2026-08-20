import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldRow } from './FieldRow'
import type { FieldDescriptor } from '../../configs/types'

describe('FieldRow', () => {
  it('text: renders the current value and reports typed changes', () => {
    const onChange = vi.fn()
    const field: FieldDescriptor = { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. acme' }
    render(<FieldRow field={field} value="hello" onChange={onChange} />)

    const input = screen.getByPlaceholderText('e.g. acme') as HTMLInputElement
    expect(input.value).toBe('hello')
    fireEvent.change(input, { target: { value: 'world' } })
    expect(onChange).toHaveBeenCalledWith('world')
  })

  it('text: falls back to the label as placeholder when none is given', () => {
    const field: FieldDescriptor = { key: 'name', label: 'Name', type: 'text' }
    render(<FieldRow field={field} value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
  })

  it('number: reports typed value as a number, and empty input as 0', () => {
    const onChange = vi.fn()
    const field: FieldDescriptor = { key: 'count', label: 'Count', type: 'number' }
    render(<FieldRow field={field} value={3} onChange={onChange} />)

    const input = screen.getByDisplayValue('3')
    fireEvent.change(input, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith(7)

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('boolean: reflects checked state and reports toggles', () => {
    const onChange = vi.fn()
    const field: FieldDescriptor = { key: 'enabled', label: 'Enabled', type: 'boolean' }
    render(<FieldRow field={field} value={false} onChange={onChange} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('select: lists every option and reports the selected one', () => {
    const onChange = vi.fn()
    const field: FieldDescriptor = { key: 'runtime', label: 'Runtime', type: 'select', options: ['node', 'python'] }
    render(<FieldRow field={field} value="node" onChange={onChange} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('node')
    fireEvent.change(select, { target: { value: 'python' } })
    expect(onChange).toHaveBeenCalledWith('python')
  })

  describe('select-or-text', () => {
    const field: FieldDescriptor = {
      key: 'tenant',
      label: 'Tenant',
      type: 'select-or-text',
      options: ['acme', 'globex'],
      maxLength: 12,
    }

    it('shows the dropdown when the current value is one of the known options', () => {
      render(<FieldRow field={field} value="acme" onChange={vi.fn()} />)
      expect(screen.getByRole('radio', { name: 'Existing' })).toBeChecked()
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('shows a free-text input when the current value is not a known option', () => {
      render(<FieldRow field={field} value="brand-new" onChange={vi.fn()} />)
      expect(screen.getByRole('radio', { name: 'New' })).toBeChecked()
      const input = screen.getByDisplayValue('brand-new') as HTMLInputElement
      expect(input.maxLength).toBe(12)
    })

    it('switching to "New" clears the value; switching to "Existing" picks the first option', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value="acme" onChange={onChange} />)
      fireEvent.click(screen.getByRole('radio', { name: 'New' }))
      expect(onChange).toHaveBeenCalledWith('')

      onChange.mockClear()
      render(<FieldRow field={field} value="brand-new" onChange={onChange} />)
      fireEvent.click(screen.getAllByRole('radio', { name: 'Existing' })[1])
      expect(onChange).toHaveBeenCalledWith('acme')
    })
  })

  describe('toggle-text', () => {
    const field: FieldDescriptor = { key: 'registryDocker', label: 'Docker registry', type: 'toggle-text' }

    it('unticked (null): shows only the checkbox, no text input', () => {
      render(<FieldRow field={field} value={null} onChange={vi.fn()} />)
      expect(screen.getByRole('checkbox')).not.toBeChecked()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('ticking reports an empty string, not the value null', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value={null} onChange={onChange} />)
      fireEvent.click(screen.getByRole('checkbox'))
      expect(onChange).toHaveBeenCalledWith('')
    })

    it('ticked (non-null): shows the text input and reports edits; unticking reports null', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value="myregistry-docker" onChange={onChange} />)
      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.value).toBe('myregistry-docker')

      fireEvent.change(input, { target: { value: 'other' } })
      expect(onChange).toHaveBeenCalledWith('other')

      fireEvent.click(screen.getByRole('checkbox'))
      expect(onChange).toHaveBeenCalledWith(null)
    })
  })

  describe('computed-toggle-group', () => {
    const field: FieldDescriptor = {
      key: 'registryGroup',
      label: 'Registry name',
      type: 'computed-toggle-group',
      placeholder: 'myregistry',
      targets: [
        { key: 'registryDocker', label: 'Docker', suffix: 'docker' },
        { key: 'registryMaven', label: 'Maven', suffix: 'maven' },
      ],
    }

    it('reports base name edits without touching ticked state', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value={{ base: '', ticked: {} }} onChange={onChange} />)
      fireEvent.change(screen.getByPlaceholderText('myregistry'), { target: { value: 'myregistry' } })
      expect(onChange).toHaveBeenCalledWith({ base: 'myregistry', ticked: {} })
    })

    it('ticking one target only flips that target, leaving the base and other targets alone', () => {
      const onChange = vi.fn()
      render(
        <FieldRow
          field={field}
          value={{ base: 'myregistry', ticked: { registryMaven: true } }}
          onChange={onChange}
        />,
      )
      fireEvent.click(screen.getByRole('checkbox', { name: 'Docker' }))
      expect(onChange).toHaveBeenCalledWith({
        base: 'myregistry',
        ticked: { registryMaven: true, registryDocker: true },
      })
    })
  })

  describe('list-string', () => {
    const field: FieldDescriptor = { key: 'proxyEntries', label: 'Proxy entries', type: 'list-string', placeholder: '*.github.com' }

    it('edits the entry at the right index without disturbing the others', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value={['a', 'b']} onChange={onChange} />)
      const inputs = screen.getAllByPlaceholderText('*.github.com')
      fireEvent.change(inputs[1], { target: { value: 'b2' } })
      expect(onChange).toHaveBeenCalledWith(['a', 'b2'])
    })

    it('Add appends a blank entry; Remove is disabled at exactly one entry', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value={['a']} onChange={onChange} />)
      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(onChange).toHaveBeenCalledWith(['a', ''])
    })

    it('Remove drops the entry at that index once there is more than one', () => {
      const onChange = vi.fn()
      render(<FieldRow field={field} value={['a', 'b']} onChange={onChange} />)
      const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
      expect(removeButtons[0]).not.toBeDisabled()
      fireEvent.click(removeButtons[0])
      expect(onChange).toHaveBeenCalledWith(['b'])
    })
  })

  describe('list-object', () => {
    const field: FieldDescriptor = {
      key: 'githubTopics',
      label: 'GitHub topics',
      type: 'list-object',
      itemLabel: 'topic',
      itemFields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'name' },
        { key: 'description', label: 'Description', type: 'text', placeholder: 'description' },
      ],
    }

    it('edits a nested field on the right row only', () => {
      const onChange = vi.fn()
      const rows = [
        { name: 'billing', description: 'Billing service' },
        { name: 'infra', description: 'Infra service' },
      ]
      render(<FieldRow field={field} value={rows} onChange={onChange} />)

      const nameInputs = screen.getAllByPlaceholderText('name')
      fireEvent.change(nameInputs[1], { target: { value: 'infra-2' } })
      expect(onChange).toHaveBeenCalledWith([
        { name: 'billing', description: 'Billing service' },
        { name: 'infra-2', description: 'Infra service' },
      ])
    })

    it('Add appends a fresh empty row using the item fields’ own defaults', () => {
      const onChange = vi.fn()
      const rows = [{ name: 'billing', description: 'Billing service' }]
      render(<FieldRow field={field} value={rows} onChange={onChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'Add topic' }))
      expect(onChange).toHaveBeenCalledWith([
        { name: 'billing', description: 'Billing service' },
        { name: '', description: '' },
      ])
    })

    it('Remove is disabled with exactly one row, enabled otherwise, and drops the right row', () => {
      const onChange = vi.fn()
      const oneRow = [{ name: 'billing', description: 'Billing service' }]
      const { unmount } = render(<FieldRow field={field} value={oneRow} onChange={onChange} />)
      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
      unmount()

      const twoRows = [
        { name: 'billing', description: 'Billing service' },
        { name: 'infra', description: 'Infra service' },
      ]
      render(<FieldRow field={field} value={twoRows} onChange={onChange} />)
      const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
      fireEvent.click(removeButtons[0])
      expect(onChange).toHaveBeenCalledWith([{ name: 'infra', description: 'Infra service' }])
    })
  })
})
