import type { Role } from '../types'

// Two skins of the same cast. The terminal draws with a Raster: quadrant blocks, four
// pixels to a cell, so a character is five cells wide. The desktop app, VS Code and
// mobile draw with Svg, which has room for gear. Both sit on any theme, because a pixel
// nobody drew is the surface's own background.

type Hand = Exclude<Role, 'captain'>

/** Claude Code's own orange: the mascot's body. */
export const CLAY = '#D97757'
/** The bar's own colour: the sea, so the orange mascot stands out on it. */
export const SEA = '#2BA7B5'
export const ALERT = '#E24B4A'
export const GOOD = '#3FB27F'

export const ROLES: Record<Role, { label: string; color: string; symbol: string }> = {
  captain: { label: 'captain', color: '#3B6FD4', symbol: '⚑' },
  shipwright: { label: 'shipwright', color: '#E8833A', symbol: '⚒' },
  navigator: { label: 'navigator', color: '#B8864E', symbol: '⌕' },
  painter: { label: 'painter', color: '#D4537E', symbol: '✎' },
  lookout: { label: 'lookout', color: '#2FB5A8', symbol: '✓' },
  deckhand: { label: 'deckhand', color: '#5FAE4A', symbol: '≈' },
}

const PAL: Record<string, string> = {
  E: '#1F1410', n: '#1F2F66', g: '#F2C230', y: '#F5C542', Y: '#FFF2B0', h: '#7A4F28', b: '#8A5A2B',
  z: '#9A9EA6', c: '#3B8FE0', r: '#C93A3A', R: '#8E2424', t: '#E8D7B5', w: '#F4F4F4', k: '#2A2E36', l: '#7FB7E6',
}

const CONFETTI = ['#F5C542', '#D4537E', '#3B8FE0', '#5FAE4A', '#FFF2B0', '#E8833A']

function mix(hex: string, to: string, t: number): string {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

/** A finished crew member's colour: mostly grey, a hint of what it was. */
export function fade(color: string): string {
  return mix(color, '#7A7F88', 0.7)
}

/** What the mascot is doing: walking the bar, celebrating, asleep, waiting for you, shaken, or just standing. */
export type Pose = 'walk' | 'jump' | 'sleep' | 'alert' | 'shake' | 'still'

/** Whose body is drawn: Claude's own, the captain's coat, or a crew role. */
export type Who = 'clawd' | Role

const bodyOf = (who: Who) => (who === 'clawd' || who === 'captain' ? CLAY : ROLES[who].color)

// ── The wave: a fill whose crest runs along its top edge ───────────────────

const TRACK = '#2A2725'
const crest = (x: number, frame: number) => Math.sin((x + frame * 0.5) / 2.2) > 0.15

// ── Terminal: pixels in quadrant cells ─────────────────────────────────────

export type RasterSpec = { key: string; columns: number; rows: number; cells: string }

const TERM_DEFAULT = 0x01000000
/** The widest Raster the terminal surface takes. */
export const MAX_RASTER_COLUMNS = 512
const fitColumns = (n: number) => Math.max(1, Math.min(MAX_RASTER_COLUMNS, Math.floor(n)))
const SPACE = 0x20
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const rgb = (hex: string) => parseInt(hex.slice(1), 16)

// The block whose set quadrants are the foreground; top-left is 8, top-right 4,
// bottom-left 2, bottom-right 1.
const QUADRANT = [0x20, 0x2597, 0x2596, 0x2584, 0x259d, 0x2590, 0x259e, 0x259f, 0x2598, 0x259a, 0x258c, 0x2599, 0x2580, 0x259c, 0x259b, 0x2588]

/** Little-endian u32 words as padded base64: a Raster's `cells`. */
function encode(words: number[]): string {
  const bytes: number[] = []
  for (const w of words) bytes.push(w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

type Canvas = Array<Array<string | undefined>>

/**
 * A canvas of hex colours (undefined: nothing drawn) as cells of 2x2 pixels. A cell
 * shows two colours at most, so a drawing keeps to that: its two commonest, and a
 * third turns into the second. A cell with one colour and holes lets the terminal's
 * own background through the holes.
 */
function quadrants(key: string, canvas: Canvas, columns: number): RasterSpec {
  const rows = Math.max(1, Math.ceil(canvas.length / 2))
  const words: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const px = [canvas[r * 2]?.[c * 2], canvas[r * 2]?.[c * 2 + 1], canvas[r * 2 + 1]?.[c * 2], canvas[r * 2 + 1]?.[c * 2 + 1]]
      const count = new Map<string, number>()
      for (const p of px) if (p) count.set(p, (count.get(p) ?? 0) + 1)
      const painted = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color)
      if (painted.length === 0) {
        words.push(SPACE, TERM_DEFAULT, TERM_DEFAULT)
        continue
      }
      const fg = painted[0]!
      const bg = painted[1]
      let bits = 0
      px.forEach((p, i) => {
        if (p === fg) bits |= 8 >> i
      })
      words.push(QUADRANT[bits]!, rgb(fg), bg ? rgb(bg) : TERM_DEFAULT)
    }
  }
  return { key, columns, rows, cells: encode(words) }
}

// One line of mascot, 10x2 pixels. X is the body; every cell that mixes two colours is
// fully painted, so none leaks the second colour into a hole.
const LINE: Record<'stand' | 'step' | 'sleep', [string, string]> = {
  stand: ['XXEXXXXEXX', 'XXXX..XXXX'],
  step: ['XXEXXXXEXX', '..XXXXXX..'],
  sleep: ['XXXXXXXXXX', 'XXXX..XXXX'],
}
const LINE_W = 10

// the captain's shoulders carry gold epaulettes
const epaulettes = (row: string) => `g${row.slice(1, -1)}g`

const paint = (row: string, body: string): Array<string | undefined> =>
  [...row].map(ch => (ch === '.' ? undefined : ch === 'X' ? body : PAL[ch]))

/**
 * The bar of the terminal band as one Raster row, the mascot standing at the edge of
 * what is done. The crest runs along the fill; at the end of a turn confetti lands on
 * the bar; a shaken mascot jitters one cell either way.
 */
export function bandRaster(o: {
  key: string
  columns: number
  captain: boolean
  pose: Pose
  frame: number
  ratio: number
  color: string
}): RasterSpec {
  const columns = fitColumns(o.columns)
  const px = columns * 2
  const hi = mix(o.color, '#FFFFFF', 0.45)
  const to = Math.round(px * Math.max(0, Math.min(1, o.ratio)))
  const top: Array<string | undefined> = []
  const bottom: Array<string | undefined> = []
  for (let x = 0; x < px; x++) {
    top.push(x < to ? (crest(x, o.frame) ? hi : o.color) : TRACK)
    bottom.push(x < to ? o.color : TRACK)
  }
  if (o.pose === 'jump') {
    const step = Math.floor(o.frame / 3)
    for (let c = 0; c < columns; c++) {
      if ((c * 3 + step) % 7 === 0) top[c * 2] = top[c * 2 + 1] = CONFETTI[(c + step) % CONFETTI.length]!
    }
  }
  const cells = LINE_W / 2
  if (columns >= cells) {
    const shake = o.pose === 'shake' ? (Math.floor(o.frame / 2) % 2 ? 1 : -1) : 0
    const c0 = Math.max(0, Math.min(columns - cells, Math.round((columns - cells) * o.ratio) + shake))
    const walking = o.pose === 'walk' || o.pose === 'jump'
    const [a, b] = LINE[o.pose === 'sleep' ? 'sleep' : walking && Math.floor(o.frame / 2) % 2 === 1 ? 'step' : 'stand']
    const ta = paint(o.captain ? epaulettes(a) : a, CLAY)
    const tb = paint(b, CLAY)
    for (let i = 0; i < LINE_W; i++) {
      top[c0 * 2 + i] = ta[i]
      bottom[c0 * 2 + i] = tb[i]
    }
  }
  return quadrants(o.key, [top, bottom], columns)
}

// A crew member, 10x4 pixels: a hat on the first row, the body in its role's colour. A
// hat is over the pairs of pixels where the body is, or past them where there is none.
const HAT: Record<Hand, string> = {
  shipwright: '.yyyyyyyy.',
  navigator: 'bbbbbbbbbb',
  painter: '..rrrrrrrr',
  lookout: '..wwwwww..',
  deckhand: '..llllll..',
}
const CAPTAIN_HAT = 'nnnnggnnnn'

/**
 * One crew member for the terminal panel: five cells wide and two tall. While it
 * works its feet shuffle; once it is done it greys out and stands still.
 */
export function crewRaster(role: Role, key: string, working: boolean, frame: number, faded: boolean): RasterSpec {
  const body = ROLES[role].color
  const step = working && Math.floor(frame / 2) % 2 === 1
  const rows = [role === 'captain' ? CAPTAIN_HAT : HAT[role], '..BBBBBB..', 'BBEBBBBEBB', step ? '..BBBBBB..' : 'BBBB..BBBB']
  const tone = (ch: string): string | undefined => {
    if (ch === '.') return undefined
    const color = ch === 'B' ? body : PAL[ch]!
    return faded && ch !== 'E' ? fade(color) : color
  }
  return quadrants(key, rows.map(r => [...r].map(tone)), 5)
}

/** A thin bar for a crew row, in the terminal: two pixel rows, the crest on the fill. */
export function barRaster(o: { key: string; columns: number; ratio: number; color: string; frame: number; still: boolean }): RasterSpec {
  const columns = fitColumns(o.columns)
  const px = columns * 2
  const hi = mix(o.color, '#FFFFFF', 0.45)
  const to = Math.round(px * Math.max(0, Math.min(1, o.ratio)))
  const top: Array<string | undefined> = []
  const bottom: Array<string | undefined> = []
  for (let x = 0; x < px; x++) {
    top.push(x < to ? (!o.still && crest(x, o.frame) ? hi : o.color) : TRACK)
    bottom.push(x < to ? o.color : TRACK)
  }
  return quadrants(o.key, [top, bottom], columns)
}

// ── Desktop, VS Code and mobile: pixel art in Svg ──────────────────────────

export type Sprite = { source: string; width: number; height: number }

const GW = 16
const GH = 14
type Grid = string[][]

function box(g: Grid, ch: string, x0: number, x1: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y >= 0 && y < GH && x >= 0 && x < GW) g[y]![x] = ch
}
const dot = (g: Grid, ch: string, ...cells: Array<[number, number]>) => cells.forEach(([x, y]) => box(g, ch, x, x, y, y))

// The mascot: a wide body, stub arms at the middle, one-pixel-wide eyes and four feet.
function clawd(g: Grid) {
  box(g, 'X', 3, 12, 4, 9)
  box(g, 'X', 1, 2, 6, 7)
  box(g, 'X', 13, 14, 6, 7)
  for (const x of [4, 6, 9, 11]) box(g, 'X', x, x, 10, 11)
  box(g, 'E', 5, 5, 6, 7)
  box(g, 'E', 10, 10, 6, 7)
}

// What each role wears, drawn over the mascot.
const GEAR: Record<Role, (g: Grid) => void> = {
  // tricorn with a gold band, epaulettes
  captain: g => {
    box(g, 'n', 4, 11, 2, 3)
    dot(g, 'n', [3, 3], [12, 3])
    box(g, 'g', 7, 8, 3, 3)
    box(g, 'g', 3, 3, 4, 5)
    box(g, 'g', 12, 12, 4, 5)
    dot(g, 'g', [7, 8], [8, 8])
  },
  // hard hat and a hammer
  shipwright: g => {
    box(g, 'y', 5, 10, 2, 2)
    box(g, 'y', 4, 11, 3, 3)
    dot(g, 'Y', [6, 2])
    box(g, 'h', 15, 15, 4, 7)
    box(g, 'z', 14, 15, 2, 3)
  },
  // explorer hat and a spyglass
  navigator: g => {
    box(g, 'b', 5, 10, 1, 2)
    box(g, 'b', 3, 12, 3, 3)
    box(g, 'z', 15, 15, 3, 6)
    dot(g, 'c', [15, 2])
  },
  // beret, a brush and a palette
  painter: g => {
    box(g, 'r', 4, 10, 2, 3)
    dot(g, 'R', [7, 1])
    box(g, 'h', 15, 15, 3, 8)
    box(g, 'c', 15, 15, 1, 2)
    box(g, 't', 0, 1, 7, 9)
    dot(g, 'r', [0, 8])
    dot(g, 'c', [1, 8])
    dot(g, 'y', [1, 9])
  },
  // white cap and binoculars on the chest
  lookout: g => {
    box(g, 'w', 5, 10, 2, 2)
    box(g, 'w', 4, 11, 3, 3)
    box(g, 'k', 5, 6, 8, 9)
    box(g, 'k', 9, 10, 8, 9)
    box(g, 'k', 7, 8, 8, 8)
    dot(g, 'c', [5, 9], [9, 9])
  },
  // knit cap with a pom and a coil of rope
  deckhand: g => {
    box(g, 'l', 5, 10, 2, 3)
    dot(g, 'w', [7, 1], [8, 1])
    box(g, 't', 0, 1, 6, 8)
    dot(g, 'h', [0, 7], [1, 8])
  },
}

export type Pixel = { x: number; y: number; fill: string }

const Z_GLYPH = ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX']
// where each piece of confetti starts and falls, scattered by hand
const CONFETTI_X = [0, 2, 4, 6, 8, 10, 12, 14, 1, 5, 9, 13]
const CONFETTI_Y = [3, 0, 5, 2, 6, 1, 4, 0, 6, 3, 2, 5]

/**
 * The pixels of one character in a pose and a frame, in a fixed 16x15 frame (y from
 * -1): the mascot never changes size, so it walks along the bar without shaking the
 * layout. Confetti, the sleeper's Z and the "!" use the room above its head.
 */
export function pixels(who: Who, pose: Pose, frame = 0, tint?: (hex: string) => string): Pixel[] {
  const g: Grid = Array.from({ length: GH }, () => Array<string>(GW).fill('.'))
  clawd(g)
  if (who !== 'clawd') GEAR[who](g)
  const step = Math.floor(frame / 2)
  if (pose === 'walk') for (const x of step % 2 ? [6, 9] : [4, 11]) box(g, '.', x, x, 11, 11)
  if (pose === 'sleep') {
    // closed eyes: the body closes over them
    box(g, 'X', 5, 5, 6, 7)
    box(g, 'X', 10, 10, 6, 7)
  }
  if (pose === 'alert') {
    box(g, '.', 13, 14, 6, 7)
    box(g, 'X', 13, 14, 4, 5)
    box(g, 'X', 14, 14, 2, 3)
  }
  if (pose === 'jump') {
    box(g, '.', 1, 2, 6, 7)
    box(g, '.', 13, 14, 6, 7)
    box(g, 'X', 1, 2, 4, 5)
    box(g, 'X', 13, 14, 4, 5)
    box(g, 'X', 1, 1, 2, 3)
    box(g, 'X', 14, 14, 2, 3)
  }
  const dy = pose === 'walk' ? -(step % 2) : pose === 'jump' ? -[0, 1, 2, 1][Math.floor(frame / 2) % 4]! : 0
  const dx = pose === 'shake' ? (Math.floor(frame / 2) % 2 ? 1 : -1) : 0
  const body = who === 'clawd' ? CLAY : bodyOf(who)
  const ink = (ch: string) => {
    const hex = ch === 'X' ? body : PAL[ch]
    return hex && tint && ch !== 'E' ? tint(hex) : hex
  }
  const out: Pixel[] = []
  g.forEach((row, y) =>
    row.forEach((ch, x) => {
      const fill = ink(ch)
      if (fill) out.push({ x: x + dx, y: y + dy, fill })
    }),
  )
  if (pose === 'jump') {
    const fall = Math.floor(frame / 2)
    CONFETTI_X.forEach((x, i) => {
      const y = ((fall + CONFETTI_Y[i]!) % 7) - 1
      if (g[y - dy]?.[x - dx] === '.' || g[y - dy]?.[x - dx] === undefined) out.push({ x, y, fill: CONFETTI[i % CONFETTI.length]! })
    })
  }
  if (pose === 'sleep') {
    const [x0, y0] = frame % 2 ? [11, -1] : [10, 1]
    Z_GLYPH.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && out.push({ x: x0! + i, y: y0! + j, fill: '#C9CCD1' })))
  }
  if (pose === 'alert') for (const y of [0, 1, 2, 4]) out.push({ x: 15, y, fill: '#F5C542' })
  return out
}

/** A character as an Svg source: the same 16x15 frame for every pose and frame. */
export function spriteSvg(who: Who, pose: Pose, frame: number, scale: number, tint?: (hex: string) => string): Sprite {
  const rects = pixels(who, pose, frame, tint)
    .map(p => `<rect x="${p.x}" y="${p.y}" width="1.02" height="1.02" fill="${p.fill}"/>`)
    .join('')
  const vh = GH + 1
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${GW * scale}" height="${vh * scale}" viewBox="0 -1 ${GW} ${vh}" shape-rendering="crispEdges">${rects}</svg>`,
    width: GW * scale,
    height: vh * scale,
  }
}

const COLS = 60
const ROWS = 3

/**
 * The progress bar as an Svg stretched to the width it is given: a filled run with a
 * crest on top that rolls along it. `still` is the bar of a finished crew member, with
 * no crest, so every frame is the same drawing.
 */
export function barSvg(o: { ratio: number; color: string; frame?: number; still?: boolean }): string {
  const hi = mix(o.color, '#FFFFFF', 0.45)
  const to = Math.round(COLS * Math.max(0, Math.min(1, o.ratio)))
  const rect = (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
  let body = rect(0, 0, COLS, ROWS, TRACK)
  if (to > 0) {
    body += rect(0, 0, to, ROWS, o.color)
    if (!o.still) for (let x = 0; x < to; x++) if (crest(x, o.frame ?? 0)) body += rect(x, 0, 1, 1, hi)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${ROWS * 4}" viewBox="0 0 ${COLS} ${ROWS}" preserveAspectRatio="none" shape-rendering="crispEdges">${body}</svg>`
}
