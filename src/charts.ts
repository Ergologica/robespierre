import { formatPct } from './lib/format'
/**
 * Grafici SVG senza dipendenze. Palette validata per daltonismo e contrasto
 * (vedi README §Palette): --s1 cinabro, --s2 petrolio, --s3 glicine.
 * Regole: identità mai affidata al solo colore (etichette dirette + tooltip),
 * testo sempre nei colori di inchiostro, mai nel colore della serie.
 */

const NS = 'http://www.w3.org/2000/svg'

function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const n = document.createElementNS(NS, name) as SVGElement
  for (const k in attrs) n.setAttribute(k, String(attrs[k]))
  if (text != null) n.textContent = text
  return n
}
function svg(w: number, h: number): SVGSVGElement {
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img' }) as SVGSVGElement
  s.style.display = 'block'
  return s
}

/* ---- tooltip unico, riusato da tutti i grafici ---- */
let tip: HTMLDivElement | null = null
function ensureTip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'tip'
    document.body.appendChild(tip)
  }
  return tip
}
export function bindTip(node: Element, title: string, line: string): void {
  node.classList.add('mark')
  node.addEventListener('mousemove', ev => {
    const e = ev as MouseEvent, t = ensureTip()
    t.innerHTML = `<div class="tl"></div><div></div>`
    ;(t.children[0] as HTMLElement).textContent = title
    ;(t.children[1] as HTMLElement).textContent = line
    t.classList.add('on')
    let x = e.clientX + 14
    if (x + 260 > window.innerWidth) x = e.clientX - 260
    t.style.left = x + 'px'; t.style.top = (e.clientY + 14) + 'px'
  })
  node.addEventListener('mouseleave', () => ensureTip().classList.remove('on'))
}

/* ---- meter: un rapporto contro un limite ---- */
export function meter(host: HTMLElement, o: {
  label: string; big: string; pct: number; left: string; right: string; tipTitle: string; tipLine: string
}): void {
  const W = 520, H = 106, y = 46, bh = 14
  const s = svg(W, H)
  s.appendChild(el('text', { x: 0, y: 16, class: 'c-lab' }, o.label))
  s.appendChild(el('text', { x: 0, y: 38, class: 'c-big' }, o.big))
  s.appendChild(el('rect', { x: 0, y, width: W, height: bh, rx: bh / 2, fill: 'var(--track)' }))
  const f = el('rect', { x: 0, y, width: Math.round(W * Math.min(1, o.pct)), height: bh, rx: bh / 2, fill: 'var(--s1)' })
  bindTip(f, o.tipTitle, o.tipLine)
  s.appendChild(f)
  s.appendChild(el('text', { x: 0, y: y + 32, class: 'c-small' }, o.left))
  s.appendChild(el('text', { x: W, y: y + 32, class: 'c-small', 'text-anchor': 'end' }, o.right))
  host.replaceChildren(s)
}

/* ---- ciambella: parti di un intero (≤6 spicchi, etichetta ≥5%) ---- */
export interface Slice { label: string; value: number; color: string; tipLine: string; approx?: string }
export function donut(host: HTMLElement, slices: Slice[], centerBig: string, centerSmall: string): void {
  const W = 520, H = Math.max(240, 62 + slices.length * 46 + 12), cx = 128, cy = 120, R = 88, r = 56
  const tot = slices.reduce((a, b) => a + b.value, 0) || 1
  const s = svg(W, H)
  let a = -Math.PI / 2
  const pad = 2 / R
  for (const d of slices) {
    const sweep = 2 * Math.PI * d.value / tot
    const a0 = a + pad / 2, a1 = Math.max(a0, a + sweep - pad / 2)
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = ['M', cx + R * Math.cos(a0), cy + R * Math.sin(a0),
      'A', R, R, 0, large, 1, cx + R * Math.cos(a1), cy + R * Math.sin(a1),
      'L', cx + r * Math.cos(a1), cy + r * Math.sin(a1),
      'A', r, r, 0, large, 0, cx + r * Math.cos(a0), cy + r * Math.sin(a0), 'Z'].join(' ')
    const seg = el('path', { d: p, fill: d.color })
    const pc = 100 * d.value / tot
    bindTip(seg, d.label, d.tipLine)
    s.appendChild(seg)
    if (pc >= 5) {
      const am = a + sweep / 2, lx = cx + (R + 20) * Math.cos(am), ly = cy + (R + 20) * Math.sin(am)
      const anchor = Math.cos(am) < -0.2 ? 'end' : Math.cos(am) > 0.2 ? 'start' : 'middle'
      s.appendChild(el('text', { x: lx, y: ly + 4, class: 'c-val', 'text-anchor': anchor },
        formatPct(pc, 1) + '%'))
    }
    a += sweep
  }
  s.appendChild(el('text', { x: cx, y: cy - 2, class: 'c-big', 'text-anchor': 'middle' }, centerBig))
  s.appendChild(el('text', { x: cx, y: cy + 18, class: 'c-small', 'text-anchor': 'middle' }, centerSmall))
  slices.forEach((d, i) => {
    const yy = 62 + i * 46
    s.appendChild(el('rect', { x: 258, y: yy - 11, width: 11, height: 11, rx: 3, fill: d.color }))
    s.appendChild(el('text', { x: 278, y: yy, class: 'c-lab' }, d.label))
    s.appendChild(el('text', { x: 278, y: yy + 19, class: 'c-val' }, d.tipLine))
    if (d.approx) s.appendChild(el('text', { x: W, y: yy + 19, class: 'c-small', 'text-anchor': 'end' }, d.approx))
  })
  host.replaceChildren(s)
}

/* ---- barre orizzontali: confronto di grandezza, una tinta ---- */
export interface HBar { label: string; value: number; rest?: boolean; tipLine: string }
export function hbars(host: HTMLElement, bars: HBar[], maxPct?: number): void {
  const W = 520, rowH = 30, top = 6, H = top + bars.length * rowH + 26
  const labW = 178, x0 = labW + 10, x1 = W - 56
  const max = maxPct ?? Math.max(...bars.map(b => b.value)) * 1.05
  const s = svg(W, H)
  const ticks = 5
  for (let i = 0; i <= ticks; i++) {
    const t = max * i / ticks, gx = x0 + (x1 - x0) * i / ticks
    s.appendChild(el('line', { x1: gx, y1: top, x2: gx, y2: top + bars.length * rowH, stroke: 'var(--grid, var(--line-soft))', 'stroke-width': 1 }))
    s.appendChild(el('text', { x: gx, y: H - 6, class: 'c-small', 'text-anchor': 'middle' }, t.toFixed(0) + '%'))
  }
  bars.forEach((b, i) => {
    const y = top + i * rowH, bh = 14, w = Math.max(2, (x1 - x0) * b.value / max)
    s.appendChild(el('text', { x: labW, y: y + bh + 1, class: 'c-lab', 'text-anchor': 'end' }, b.label))
    const p = ['M', x0, y + 2, 'H', x0 + w - 4, 'a4,4 0 0 1 4,4', 'v', bh - 8, 'a4,4 0 0 1 -4,4', 'H', x0, 'Z'].join(' ')
    const bar = el('path', { d: p, fill: b.rest ? 'var(--s-rest)' : 'var(--s1)' })
    bindTip(bar, b.label, b.tipLine)
    s.appendChild(bar)
    s.appendChild(el('text', { x: x0 + w + 8, y: y + bh + 1, class: 'c-val' }, formatPct(b.value) + '%'))
  })
  host.replaceChildren(s)
}

/* ---- schema UTXO: input → transazione → output ---- */
export interface SchemaNode { title: string; sub: string; tip: string; accent?: string }
export function utxoSchema(host: HTMLElement, inputs: SchemaNode[], tx: SchemaNode, outputs: SchemaNode[],
  heads: { in: string; tx: string; out: string } = { in: 'BOX CONSUMATI (INPUT)', tx: 'TRANSAZIONE', out: 'BOX CREATI (OUTPUT)' }): void {
  const rowH = 74, colW = 316, W = 1024
  const rows = Math.max(inputs.length, outputs.length)
  const H = 30 + rows * rowH
  const s = svg(W, H)
  s.appendChild(el('text', { x: 0, y: 12, class: 'c-small' }, heads.in))
  s.appendChild(el('text', { x: 424, y: 12, class: 'c-small' }, heads.tx))
  s.appendChild(el('text', { x: W - colW, y: 12, class: 'c-small' }, heads.out))
  const node = (x: number, y: number, w: number, n: SchemaNode) => {
    const g = el('g', {})
    g.appendChild(el('rect', { x, y, width: w, height: 60, rx: 10, fill: 'var(--surface-2)',
      stroke: n.accent ?? 'var(--line)', 'stroke-width': n.accent ? 1.5 : 1 }))
    g.appendChild(el('text', { x: x + 13, y: y + 24, class: 'c-node' }, n.title))
    g.appendChild(el('text', { x: x + 13, y: y + 44, class: 'c-small' }, n.sub))
    bindTip(g, n.title, n.tip)
    s.appendChild(g)
    return { cx: x + w, cy: y + 30, lx: x, ly: y + 30 }
  }
  const midY = 24 + (rows * rowH - 74) / 2
  const t = node(424, midY, 176, tx)
  const link = (x0: number, y0: number, x1: number, y1: number) => {
    const mx = (x0 + x1) / 2
    s.insertBefore(el('path', { d: `M${x0} ${y0} C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`,
      fill: 'none', stroke: 'var(--axis, var(--line))', 'stroke-width': 2 }), s.firstChild)
  }
  inputs.forEach((n, i) => { const p = node(0, 24 + i * rowH, colW, n); link(p.cx, p.cy, 424, midY + 20 + i * 6) })
  outputs.forEach((n, i) => { const p = node(W - colW, 24 + i * rowH, colW, n); link(600, midY + 20 + i * 6, p.lx, p.ly) })
  host.replaceChildren(s)
}
