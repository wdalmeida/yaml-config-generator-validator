interface ExternalLinkProps {
  href: string
  className?: string
  children: React.ReactNode
  onClick?: () => void
}

// Every outbound link here opens a new tab, and none of them used to say so. Losing the current
// tab's context without warning is disorienting for anyone, and for a screen reader user it is
// worse: the reading position is simply gone with no announcement that anything happened
// (WCAG 3.2.5). The note is hidden visually and read as part of the link's name.
//
// It starts with a comma rather than a space on purpose. The accessible-name algorithm
// concatenates each node's *trimmed* text, so a leading space is dropped and "Docs" + " (opens
// in a new tab)" comes out as "Docs(opens in a new tab)". A comma survives and reads as a pause.
export function ExternalLink({ href, className, children, onClick }: ExternalLinkProps) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" onClick={onClick}>
      {children}
      <span className="visually-hidden">, opens in a new tab</span>
    </a>
  )
}
