import type { ReactNode } from 'react'
import { emptyObjectFor, type FieldDescriptor } from '../../configs/types'

interface FieldRowProps {
  field: FieldDescriptor
  value: unknown
  onChange: (value: unknown) => void
  // Compact rows skip the block label and lean on the placeholder instead - used for
  // fields nested inside a list-object row, where several fields sit side by side.
  compact?: boolean
}

export function FieldRow({ field, value, onChange, compact = false }: FieldRowProps) {
  switch (field.type) {
    case 'text': {
      const input = (
        <input
          value={(value as string | undefined) ?? ''}
          placeholder={field.placeholder ?? field.label}
          onChange={(e) => onChange(e.target.value)}
        />
      )
      return compact ? input : labeled(field.label, input)
    }

    case 'number': {
      const input = (
        <input
          type="number"
          value={(value as number | undefined) ?? 0}
          placeholder={field.label}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )
      return compact ? input : labeled(field.label, input)
    }

    case 'boolean':
      return (
        <label className="field-row-inline">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      )

    case 'select': {
      const select = (
        <select value={(value as string | undefined) ?? field.options[0] ?? ''} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
      return compact ? select : labeled(field.label, select)
    }

    case 'select-or-text': {
      const current = (value as string | undefined) ?? ''
      const isCustom = field.options.length === 0 || !field.options.includes(current)
      return labeled(
        field.label,
        <>
          <div className="radio-row">
            <label>
              <input
                type="radio"
                checked={!isCustom}
                disabled={!field.options.length}
                onChange={() => onChange(field.options[0] ?? '')}
              />
              Existing
            </label>
            <label>
              <input type="radio" checked={isCustom} onChange={() => onChange('')} />
              New
            </label>
          </div>
          {!isCustom ? (
            <select value={current} onChange={(e) => onChange(e.target.value)}>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input value={current} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />
          )}
        </>,
      )
    }

    case 'toggle-text': {
      const current = value as string | null
      const checked = current !== null
      return (
        <div className="field-row">
          <label className="field-row-inline">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked ? '' : null)} />
            {field.label}
          </label>
          {checked && (
            <input
              value={current}
              placeholder={field.placeholder ?? field.label}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      )
    }

    case 'computed-toggle-group': {
      const current = (value as { base: string; ticked: Record<string, boolean> } | undefined) ?? {
        base: '',
        ticked: {},
      }
      return labeled(
        field.label,
        <>
          <input
            value={current.base}
            placeholder={field.placeholder}
            onChange={(e) => onChange({ ...current, base: e.target.value })}
          />
          <div className="radio-row">
            {field.targets.map((target) => (
              <label key={target.key}>
                <input
                  type="checkbox"
                  checked={Boolean(current.ticked[target.key])}
                  onChange={(e) =>
                    onChange({ ...current, ticked: { ...current.ticked, [target.key]: e.target.checked } })
                  }
                />
                {target.label}
              </label>
            ))}
          </div>
        </>,
      )
    }

    case 'list-string': {
      const items = (value as string[] | undefined) ?? []
      return labeled(
        field.label,
        <>
          {items.map((item, index) => (
            <div className="list-row" key={index}>
              <input
                value={item}
                placeholder={field.placeholder}
                onChange={(e) => onChange(items.map((v, i) => (i === index ? e.target.value : v)))}
              />
              <button
                type="button"
                disabled={items.length === 1}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange([...items, ''])}>
            Add
          </button>
        </>,
      )
    }

    case 'list-object': {
      const items = (value as Record<string, unknown>[] | undefined) ?? []
      return labeled(
        field.label,
        <>
          {items.map((item, index) => (
            <div className="topic-row" key={index}>
              {field.itemFields.map((itemField) => (
                <FieldRow
                  key={itemField.key}
                  field={itemField}
                  value={item[itemField.key]}
                  compact
                  onChange={(v) =>
                    onChange(items.map((row, i) => (i === index ? { ...row, [itemField.key]: v } : row)))
                  }
                />
              ))}
              <button
                type="button"
                disabled={items.length === 1}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange([...items, emptyObjectFor(field.itemFields)])}>
            Add {field.itemLabel}
          </button>
        </>,
      )
    }
  }
}

function labeled(label: string, control: ReactNode) {
  return (
    <div className="field-row">
      <label>{label}</label>
      {control}
    </div>
  )
}
