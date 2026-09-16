import { useEffect, useRef, useState } from 'react'

interface CopyButtonProps {
  /** What lands on the clipboard. */
  value: string
  /** Visible text. The accessible name adds `subject` to it when one is given. */
  children: React.ReactNode
  /** Names what is being copied, for when several Copy buttons share a screen. */
  subject?: string
  disabled?: boolean
  className?: string
}

// Copying used to be entirely silent: the click did something, and nothing on the page said so.
// Sighted users could infer it; anyone using a screen reader got no signal at all, which is
// WCAG 4.1.3 (Status Messages). The confirmation lives in a role="status" region rather than in
// the button's own label, because changing a focused control's name mid-interaction is
// announced inconsistently across screen readers - a separate live region is the reliable
// mechanism, and it lets the button keep the stable name voice control needs.
export function CopyButton({ value, children, subject, disabled, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  // Cleared on unmount so a component that goes away mid-timeout doesn't set state afterwards.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // A denied or unavailable clipboard is not worth an error state here - the text is on
      // screen and selectable either way. Staying silent is better than claiming success.
      return
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        // Begins with the visible word, so voice control still matches what is on screen
        // (WCAG 2.5.3), and names the target for everyone else.
        aria-label={subject ? `Copy ${subject}` : undefined}
        onClick={handleCopy}
      >
        {children}
      </button>
      {/* <output> rather than a <span role="status">: its implicit role is status, so this is
          the same polite live region written as the element the platform already has for it
          (oxlint's jsx-a11y prefer-tag-over-role says the same). Rendered empty and filled on
          copy, rather than mounted on copy - a live region has to exist before its content
          changes or the change is not announced. */}
      <output className="visually-hidden">{copied ? `Copied ${subject ?? 'to clipboard'}` : ''}</output>
    </>
  )
}
