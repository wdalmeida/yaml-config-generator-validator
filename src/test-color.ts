// Colour maths for the palette tests. Test-only: nothing in src/ imports it, so it never
// reaches the bundle. App.contrast.test.ts uses the WCAG half, App.colorblind.test.ts the
// colour-vision-deficiency half.

/** The custom properties declared in one CSS block. */
function tokensFrom(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

/**
 * The light and dark palettes as the stylesheet actually declares them. Dark is a merge, not a
 * replacement, which is the point: it inherits every token the dark block does not restate, and
 * that is exactly how `--muted` came to sit at its light-mode value for the whole life of dark
 * mode, three-and-a-bit to one against the surface it was drawn on.
 */
export function palettes(css: string): { light: Record<string, string>; dark: Record<string, string> } {
  const lightBlock = /^:root \{(.*?)^\}/ms.exec(css)
  const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{(.*?)^ {2}\}/ms.exec(css)
  if (!lightBlock || !darkBlock) throw new Error('App.css no longer declares its palette on :root - update src/test-color.ts')
  const light = tokensFrom(lightBlock[1])
  return { light, dark: { ...light, ...tokensFrom(darkBlock[1]) } }
}

type RGB = [number, number, number]

function channels(hex: string): RGB {
  const h = hex.trim().replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const toHex = (rgb: RGB) =>
  '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, '0')).join('')

/** WCAG relative luminance. Note WCAG's 0.03928 threshold, not sRGB's 0.04045 - kept as specified. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Machado, Oliveira & Fernandes (2009) dichromacy matrices at full severity, applied in linear
 * RGB. These are the matrices the usual simulators use; they model what the three common
 * inherited deficiencies leave, not what a person "sees", which nobody can render.
 */
const CVD_MATRICES = {
  // ~1% of men: no long-wavelength cones. Red darkens toward black.
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  // ~6% of men, the most common: no medium-wavelength cones.
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  // Rare and not sex-linked: no short-wavelength cones.
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const

export type Deficiency = keyof typeof CVD_MATRICES
export const DEFICIENCIES = Object.keys(CVD_MATRICES) as Deficiency[]

export function simulate(hex: string, kind: Deficiency): string {
  const linear = channels(hex).map(toLinear) as RGB
  const m = CVD_MATRICES[kind]
  const out = m.map((row) => row.reduce((sum, coeff, i) => sum + coeff * linear[i], 0))
  return toHex(out.map((c) => fromLinear(Math.max(0, Math.min(1, c)))) as RGB)
}

function toLab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear)
  // D65, the same white point the sRGB primaries above assume.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * CIEDE2000, the current CIE colour-difference formula. Plain Euclidean distance in Lab
 * overstates differences in the blues and understates them in the yellows, which is precisely
 * the region a dichromacy simulation collapses everything into - so the cheaper formula would
 * flatter exactly the cases this is meant to catch.
 */
export function deltaE(hex1: string, hex2: string): number {
  const [L1, a1, b1] = toLab(hex1)
  const [L2, a2, b2] = toLab(hex2)
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = Cbar > 0 ? 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7))) : 0
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = a1p || b1 ? ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360 : 0
  const h2p = a2p || b2 ? ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360 : 0

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2)

  const Lbar = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbar = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbar = (h1p + h2p) / 2
    else hbar = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbar - 30)) +
    0.24 * Math.cos(rad(2 * hbar)) +
    0.32 * Math.cos(rad(3 * hbar + 6)) -
    0.2 * Math.cos(rad(4 * hbar - 63))
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2)
  const Sc = 1 + 0.045 * Cbarp
  const Sh = 1 + 0.015 * Cbarp * T
  const Rt =
    -Math.sin(rad(2 * (30 * Math.exp(-(((hbar - 275) / 25) ** 2))))) *
    (Cbarp > 0 ? 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7)) : 0)

  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

/** The smallest deltaE between two colours across normal vision and all three dichromacies. */
export function worstSeparation(a: string, b: string): { deltaE: number; vision: string } {
  let worst = { deltaE: deltaE(a, b), vision: 'normal vision' }
  for (const kind of DEFICIENCIES) {
    const d = deltaE(simulate(a, kind), simulate(b, kind))
    if (d < worst.deltaE) worst = { deltaE: d, vision: kind }
  }
  return worst
}
