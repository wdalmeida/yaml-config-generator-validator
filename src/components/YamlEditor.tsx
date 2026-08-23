import { useEffect, useRef } from 'react'
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
  '&.cm-focused': {
    outline: 'none',
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
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
}

// A minimal, hand-wired CodeMirror 6 wrapper - no @uiw/react-codemirror, no `codemirror`
// meta-package (both pull in autocomplete/search/theming this app doesn't use). Lazy-loaded
// (see ConfigWorkspace's `React.lazy`) since CodeMirror is the single largest dependency here -
// see .size-limit.json's separate "YAML editor (lazy-loaded)" budget entry.
export default function YamlEditor({ value, onChange, onFocus, onBlur, placeholder: placeholderText }: YamlEditorProps) {
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
  const initialPlaceholderRef = useRef(placeholderText)

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
        initialPlaceholderRef.current ? placeholder(initialPlaceholderRef.current) : [],
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
