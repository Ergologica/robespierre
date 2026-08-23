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
  // larghezza NATURALE + max-width dal CSS: con width:100% e altezza fissa il
  // browser conservava le proporzioni e centrava il disegno dentro la scheda,
  // così ogni grafico risultava disallineato rispetto al testo che lo introduce.
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img' }) as SVGSVGElement
  s.style.cssText = 'display:block;max-width:100%;height:auto'
  return s
}

/** Larghezza REALE del contenitore: i grafici si ridisegnano alla misura della
 *  scheda invece di essere stirati. Stirare un SVG con viewBox ingrandisce anche
 *  il testo — a metà scheda vuota si rimediava col doppio dei caratteri. */
/** PURA: un passo di tacche "gentile" (1·2·5 ×10^n) e il massimo arrotondato.
 *  Prima le tacche uscivano 0 · 10 · 21 · 31 · 41 · 51: aritmeticamente giuste,
 *  illeggibili come scala. */
export function niceScale(max: number, targetTicks = 5): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 }
  const raw = max / targetTicks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  return { max: Math.ceil(max / step) * step, step }
}

function hostWidth(host: HTMLElement, min: number, max: number): number {
  const cs = getComputedStyle(host)
  const inner = host.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
  return Math.round(Math.min(max, Math.max(min, inner || min)))
}

/** Nome accessibile del grafico: senza, uno screen reader annuncia "immagine" e basta.
 *  Il testo descrive i DATI, non la forma ("il 48,9% al primo detentore", non "grafico a barre"). */
function titled(s: SVGSVGElement, text: string): SVGSVGElement {
  const t = el('title', {}, text)
  s.insertBefore(t, s.firstChild)
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
  const W = hostWidth(host, 320, 1000), H = 106, y = 46, bh = 14
  const s = titled(svg(W, H), `${o.label}: ${o.big} (${o.left})`)
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
  const W = hostWidth(host, 460, 760), H = Math.max(240, 62 + slices.length * 46 + 12), cx = 128, cy = 120, R = 88, r = 56
  const tot = slices.reduce((a, b) => a + b.value, 0) || 1
  const s = titled(svg(W, H), `${centerSmall} ${centerBig}. ` +
    slices.map(d => `${d.label} ${formatPct(100 * d.value / tot, 1)}%`).join(', '))
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
  const W = hostWidth(host, 460, 1000), rowH = 30, top = 6, H = top + bars.length * rowH + 26
  const labW = 178, x0 = labW + 10, x1 = W - 56
  const scale = niceScale(maxPct ?? Math.max(...bars.map(b => b.value)))
  const max = maxPct ?? scale.max
  const ticks = maxPct ? 5 : Math.round(scale.max / scale.step)
  const s = titled(svg(W, H), bars.map(b => `${b.label} ${formatPct(b.value, 1)}%`).join(', '))
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
  const s = titled(svg(W, H),
    `${heads.in}: ${inputs.map(n => n.title).join(', ')} → ${heads.out}: ${outputs.map(n => n.title).join(', ')}`)
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

/** Sparkline temporale: pochi punti, una linea, minimo/massimo dichiarati.
 *  Nessuna finzione di continuità: i punti veri restano visibili come pallini. */
export interface SparkPoint { t: number; v: number }

/** PURA: dominio verticale della serie. La scala la decidono i DATI, con un
 *  margine; la banda di riferimento si disegna solo per la parte che cade
 *  dentro. Prima era il contrario — la banda 400–800% imponeva il dominio e i
 *  dati veri (243–257) finivano schiacciati in un decimo dell'altezza, con il
 *  grafico ridotto a un rettangolo grigio vuoto. */
export function sparkDomain(values: number[], band?: [number, number]): { y0: number; y1: number; bandVisible: [number, number] | null } {
  let lo = Math.min(...values), hi = Math.max(...values)
  if (hi - lo < 1e-9) { lo -= Math.max(1, Math.abs(lo) * 0.02); hi += Math.max(1, Math.abs(hi) * 0.02) }
  const pad = (hi - lo) * 0.18
  let y0 = lo - pad, y1 = hi + pad
  let bandVisible: [number, number] | null = null
  if (band) {
    // se una soglia è appena fuori, si allarga un po' per mostrarla; se è
    // lontanissima, non si deforma il grafico: lo dice la riga di stato sotto
    const range = y1 - y0
    if (band[0] > y0 && band[0] < y1 + range * 0.35) y1 = Math.max(y1, Math.min(band[1], band[0] + range * 0.1))
    const b0 = Math.max(band[0], y0), b1 = Math.min(band[1], y1)
    if (b1 > b0) bandVisible = [b0, b1]
  }
  return { y0, y1, bandVisible }
}

export function sparkline(host: HTMLElement, pts: SparkPoint[], o: { label: string; unit?: string; band?: [number, number] }): void {
  if (pts.length < 2) return
  const W = hostWidth(host, 460, 1000), H = 132, L0 = 46, R = 74, T = 30, B = 22
  const u = o.unit ?? ''
  const s = titled(svg(W, H), `${o.label}: da ${formatPct(pts[0]!.v, 1)}${u} a ${formatPct(pts[pts.length - 1]!.v, 1)}${u} in ${pts.length} rilevazioni`)
  const xs = pts.map(p => p.t)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const { y0, y1, bandVisible } = sparkDomain(pts.map(p => p.v), o.band)
  const X = (t: number) => L0 + (t - x0) / (x1 - x0 || 1) * (W - L0 - R)
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B)

  s.appendChild(el('text', { x: 0, y: 14, class: 'c-lab' }, o.label))
  // banda di riferimento: solo la parte che cade nella scala dei dati
  if (bandVisible) {
    s.appendChild(el('rect', { x: L0, y: Y(bandVisible[1]), width: W - L0 - R,
      height: Math.max(1, Y(bandVisible[0]) - Y(bandVisible[1])), fill: 'var(--s2)', opacity: 0.10 }))
    s.appendChild(el('line', { x1: L0, y1: Y(bandVisible[0]), x2: W - R, y2: Y(bandVisible[0]),
      stroke: 'var(--s2)', 'stroke-width': 1, opacity: 0.55 }))
  }
  // asse verticale: due valori agli angoli, non due numeri appoggiati insieme
  s.appendChild(el('text', { x: L0 - 8, y: Y(y1) + 10, class: 'c-small', 'text-anchor': 'end' }, formatPct(y1, 0) + u))
  s.appendChild(el('text', { x: L0 - 8, y: Y(y0), class: 'c-small', 'text-anchor': 'end' }, formatPct(y0, 0) + u))
  s.appendChild(el('line', { x1: L0, y1: T, x2: L0, y2: H - B, stroke: 'var(--axis)', 'stroke-width': 1 }))

  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ')
  s.appendChild(el('path', { d, fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
  for (const p of pts) {
    const c = el('circle', { cx: X(p.t), cy: Y(p.v), r: 3, fill: 'var(--s1)',
      stroke: 'var(--surface)', 'stroke-width': 2, class: 'mark' })
    bindTip(c, formatPct(p.v, 1) + u, new Date(p.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC')
    s.appendChild(c)
  }
  const last = pts[pts.length - 1]!
  s.appendChild(el('text', { x: W - R + 8, y: Y(last.v) + 4, class: 'c-val' }, formatPct(last.v, 1) + u))
  // date agli estremi: una serie temporale senza tempo non è una serie temporale
  const day = (t: number) => new Date(t).toISOString().slice(5, 10).split('-').reverse().join('/')
  s.appendChild(el('text', { x: L0, y: H - 4, class: 'c-small' }, day(x0)))
  s.appendChild(el('text', { x: W - R, y: H - 4, class: 'c-small', 'text-anchor': 'end' }, day(x1)))
  host.replaceChildren(s)
}
