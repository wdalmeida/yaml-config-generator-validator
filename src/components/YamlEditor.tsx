import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { yaml } from '@codemirror/lang-yaml'

// Colors reference the app's own CSS custom properties (App.css), so CodeMirror's light/dark
// palette follows the same `prefers-color-scheme` block the rest of the page uses - no separate
// theme object or JS media-query listener needed.
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.85rem',
    color: 'inherit',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, monospace',
    caretColor: 'var(--accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    border: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--surface)',
  },
  // CodeMirror's own focus ring is removed because it draws inside the content box, under the
  // gutter - but it is REPLACED, not just deleted. A keyboard user tabbing into the editor got
  // no visible focus indicator at all, which is a straight WCAG 2.4.7 failure; the ring moves
  // to the wrapper so it traces the whole field, gutter included.
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-editor': {
    borderRadius: 'inherit',
  },
  '&.cm-focused.cm-editor': {
    outline: '2px solid var(--accent-strong)',
    outlineOffset: '2px',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft) !important',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
})

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  // The accessible name for the editor. CodeMirror renders a contenteditable <div>, which a
  // screen reader announces as an edit box with no name unless one is given - and unlike a
  // <textarea> there is no <label for> to attach. Required rather than optional so a new
  // caller has to decide what this field is called.
  label: string
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  // Rendered output rather than an editable document (the Kubernetes manifests are templated
  // from their inputs, so there is nothing to sync back). Fixed at mount like `placeholder`,
  // since no caller toggles it and making it reconfigurable would mean a compartment for one
  // unused case.
  readOnly?: boolean
}

// A minimal, hand-wired CodeMirror 6 wrapper - no @uiw/react-codemirror, no `codemirror`
// meta-package (both pull in autocomplete/search/theming this app doesn't use). Lazy-loaded
// (see ConfigWorkspace's `React.lazy`) since CodeMirror is the single largest dependency here -
// see .size-limit.json's separate "YAML editor (lazy-loaded)" budget entry.
export default function YamlEditor({ value, onChange, label, onFocus, onBlur, placeholder: placeholderText, readOnly = false }: YamlEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Read through refs, updated post-render (not during it), so the EditorView itself
  // (expensive to recreate) doesn't need to be rebuilt whenever a parent re-render passes new
  // function identities - only the create-on-mount effect below touches viewRef.
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const onBlurRef = useRef(onBlur)
  useEffect(() => {
    onChangeRef.current = onChange
    onFocusRef.current = onFocus
    onBlurRef.current = onBlur
  })

  // Only the value/placeholder present at mount seed the editor - later changes go through the
  // controlled-value sync effect below, not through recreating the view. Refs (not the props
  // directly) so the mount effect's dependency array can stay empty and genuinely mean
  // "run once."
  const initialValueRef = useRef(value)
  const labelRef = useRef(label)
  const initialPlaceholderRef = useRef(placeholderText)
  const readOnlyRef = useRef(readOnly)

  useEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      doc: initialValueRef.current,
      parent: hostRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        indentOnInput(),
        yaml(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        theme,
        // Read once at mount like the other refs below: no caller changes it, and rebuilding
        // the view to rename a field nobody renames would cost a compartment for nothing.
        EditorView.contentAttributes.of({
          'aria-label': labelRef.current,
          // Announced as a multi-line edit box rather than a single-line one, which is what it
          // is - and, when read-only, the rendered output it actually is.
          ...(readOnlyRef.current ? { 'aria-readonly': 'true' } : {}),
        }),
        initialPlaceholderRef.current ? placeholder(initialPlaceholderRef.current) : [],
        // Both: readOnly blocks edit transactions, editable removes the contenteditable and
        // the caret, so the field reads as output rather than as an input someone is expected
        // to type into. The controlled-value sync effect below still dispatches into it.
        readOnlyRef.current ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          focus: () => onFocusRef.current?.(),
          blur: () => onBlurRef.current?.(),
        }),
      ],
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Controlled-value sync: only dispatch a change when the incoming `value` prop actually
  // differs from the editor's current document, so typing (which already updates the same
  // `value` via onChange, one render later) never fights the user's cursor position.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return <div className="yaml-editor-host" ref={hostRef} />
}
