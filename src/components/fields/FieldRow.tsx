import { useId, type ReactNode } from 'react'
import { emptyObjectFor, type FieldDescriptor } from '../../configs/types'

interface FieldRowProps {
  field: FieldDescriptor
  value: unknown
  onChange: (value: unknown) => void
  // Compact rows drop the block label - used for fields nested inside a list-object row, where
  // several sit side by side. They do NOT drop the accessible name: `compact` swaps a visible
  // <label> for an aria-label, because a placeholder is not a label. It disappears the moment
  // anyone types, which is exactly when a screen reader user asks what the field was.
  compact?: boolean
  // Names the row this field belongs to, for the same reason. Inside "GitHub topics" the third
  // row's name field is "name" three times over otherwise; this makes it "name, topic 3".
  rowLabel?: string
}

export function FieldRow({ field, value, onChange, compact = false, rowLabel }: FieldRowProps) {
  // One id per mounted field, so <label for> points at this instance and not at the same-named
  // field in the row above. useId is stable across server/client and across re-renders.
  const id = useId()
  const compactLabel = rowLabel ? `${field.label}, ${rowLabel}` : field.label

  switch (field.type) {
    case 'text': {
      const input = (
        <input
          id={compact ? undefined : id}
          aria-label={compact ? compactLabel : undefined}
          value={(value as string | undefined) ?? ''}
          placeholder={field.placeholder ?? field.label}
          onChange={(e) => onChange(e.target.value)}
        />
      )
      return compact ? input : labeled(id, field.label, input)
    }

    case 'number': {
      const input = (
        <input
          id={compact ? undefined : id}
          aria-label={compact ? compactLabel : undefined}
          type="number"
          value={(value as number | undefined) ?? 0}
          placeholder={field.label}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )
      return compact ? input : labeled(id, field.label, input)
    }

    case 'boolean':
      return (
        <label className="field-row-inline">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {compact ? compactLabel : field.label}
        </label>
      )

    case 'select': {
      const select = (
        <select
          id={compact ? undefined : id}
          aria-label={compact ? compactLabel : undefined}
          value={(value as string | undefined) ?? field.options[0] ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
      return compact ? select : labeled(id, field.label, select)
    }

    case 'select-or-text': {
      const current = (value as string | undefined) ?? ''
      const isCustom = field.options.length === 0 || !field.options.includes(current)
      // A group of several controls, so a <fieldset> with a <legend> rather than a <label>: a
      // label may name exactly one control, and the Existing/New radios plus the input or
      // select below them are four. The legend names the whole group, which is what a screen
      // reader announces before each control in it.
      return (
        <fieldset className="field-row field-group">
          <legend>{field.label}</legend>
          <div className="radio-row">
            <label>
              <input
                type="radio"
                name={id}
                checked={!isCustom}
                disabled={!field.options.length}
                onChange={() => onChange(field.options[0] ?? '')}
              />
              Existing
            </label>
            <label>
              <input type="radio" name={id} checked={isCustom} onChange={() => onChange('')} />
              New
            </label>
          </div>
          {!isCustom ? (
            <select aria-label={`${field.label}, existing`} value={current} onChange={(e) => onChange(e.target.value)}>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={`${field.label}, new`}
              value={current}
              maxLength={field.maxLength}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </fieldset>
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
              aria-label={field.label}
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
      return (
        <fieldset className="field-row field-group">
          <legend>{field.label}</legend>
          <input
            id={id}
            aria-label={field.placeholder ?? field.label}
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
        </fieldset>
      )
    }

    case 'list-string': {
      const items = (value as string[] | undefined) ?? []
      return (
        <fieldset className="field-row field-group">
          <legend>{field.label}</legend>
          {items.map((item, index) => (
            <div className="list-row" key={index}>
              <input
                // Every row's input would otherwise be named only by a placeholder they share,
                // so a screen reader reads the same thing N times with no way to tell which
                // row has focus. The number is 1-based because it is spoken, not indexed.
                aria-label={`${field.label} ${index + 1}`}
                value={item}
                placeholder={field.placeholder}
                onChange={(e) => onChange(items.map((v, i) => (i === index ? e.target.value : v)))}
              />
              <button
                type="button"
                // Names the row, so a page of buttons all reading "Remove" isn't ambiguous to
                // anyone navigating by control rather than by sight. Begins with the visible
                // word, which WCAG 2.5.3 requires so voice control still matches "Remove".
                aria-label={`Remove ${field.label} ${index + 1}`}
                disabled={items.length === 1}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" aria-label={`Add ${field.label}`} onClick={() => onChange([...items, ''])}>
            Add
          </button>
        </fieldset>
      )
    }

    case 'list-object': {
      const items = (value as Record<string, unknown>[] | undefined) ?? []
      return (
        <fieldset className="field-row field-group">
          <legend>{field.label}</legend>
          {items.map((item, index) => (
            <div className="topic-row" key={index}>
              {field.itemFields.map((itemField) => (
                <FieldRow
                  key={itemField.key}
                  field={itemField}
                  value={item[itemField.key]}
                  compact
                  rowLabel={`${field.itemLabel} ${index + 1}`}
                  onChange={(v) =>
                    onChange(items.map((row, i) => (i === index ? { ...row, [itemField.key]: v } : row)))
                  }
                />
              ))}
              <button
                type="button"
                aria-label={`Remove ${field.itemLabel} ${index + 1}`}
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
        </fieldset>
      )
    }
  }
}

// A single control gets a real <label for>. It used to be a sibling <label> with no htmlFor,
// which associates with nothing at all: the text was on screen and the control was anonymous to
// every screen reader. Groups of controls don't come through here - they use fieldset/legend,
// since a label may name exactly one control.
function labeled(id: string, label: string, control: ReactNode) {
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      {control}
    </div>
  )
}
