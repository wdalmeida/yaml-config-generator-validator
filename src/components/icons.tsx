// The app's only icons. Deliberately inline rather than an icon package: four glyphs don't
// justify a dependency, and sizing them by attribute keeps them entirely out of the CSS budget.
// All four inherit `currentColor`, so light/dark mode needs no rule of its own, and all four are
// aria-hidden - the accessible name always comes from the real text beside them.
const common = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
}

export function DocsIcon() {
  return (
    <svg {...common}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3M6 8h4M6 11h4" />
    </svg>
  )
}

export function LinkIcon() {
  return (
    <svg {...common}>
      <path d="M9 3h4v4M13 3 7.5 8.5" />
      <path d="M11 9.5V13H3V5h3.5" />
    </svg>
  )
}

// A neutral issue/ticket mark, NOT Atlassian's logo - shipping a third party's trademarked mark
// in a public static site is a licence question this project hasn't taken on. The word "Jira"
// beside it is nominative reference, which is fine.
export function TicketIcon() {
  return (
    <svg {...common}>
      <path d="M2 6V4h12v2a2 2 0 0 0 0 4v2H2v-2a2 2 0 0 0 0-4Z" />
      <path d="M9 5v6" strokeDasharray="1.5 1.5" />
    </svg>
  )
}

export function TerminalIcon() {
  return (
    <svg {...common}>
      <path d="M2 3h12v10H2z" />
      <path d="m5 6.5 2 1.5-2 1.5M8.5 11H11" />
    </svg>
  )
}
