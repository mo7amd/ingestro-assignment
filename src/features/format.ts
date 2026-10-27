const nf = new Intl.NumberFormat('en-US')
const pf = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })

export const formatCount = (n: number) => nf.format(n)
export const formatPercent = (fraction: number) => pf.format(fraction)

/** Make leading/trailing spaces visible (" pro" → "·pro"), so a whitespace fix doesn't look like a no-op. */
export const showSpaces = (v: string) => v.replace(/^ +| +$/g, (m) => '·'.repeat(m.length))
