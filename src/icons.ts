/** Icone SVG originali di Robespierre: tratto 1.8, capo tondo, griglia 24. */
const wrap = (paths: string, label: string) =>
  `<svg class="ic" viewBox="0 0 24 24" width="17" height="17" role="img" aria-label="${label}"
     fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

export const icons = {
  /** rete: tre blocchi concatenati */
  net: wrap('<rect x="2.5" y="9" width="5.4" height="6"/><rect x="9.3" y="9" width="5.4" height="6"/><rect x="16.1" y="9" width="5.4" height="6"/><path d="M7.9 12h1.4M14.7 12h1.4"/>', 'Rete'),
  /** protocolli: scudo con la barra della riserva */
  shield: wrap('<path d="M12 3 19 5.6V11c0 4.6-2.9 7.6-7 9-4.1-1.4-7-4.4-7-9V5.6Z"/><path d="M8.6 12.2h6.8M8.6 12.2v2.1h4.1v-2.1"/>', 'Protocolli'),
  /** ricerca */
  search: wrap('<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>', 'Cerca'),
  /** tema: mezzaluna dentro il sole */
  theme: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/>', 'Tema'),
  /** transazione: doppia freccia */
  swap: wrap('<path d="M4 8.5h13l-2.8-2.8M20 15.5H7l2.8 2.8"/>', 'Transazione'),
  /** token: moneta con sigma stilizzata */
  token: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M15 8.5H9.6l3.4 3.5-3.4 3.5H15"/>', 'Token'),
  /** banca: colonne */
  bank: wrap('<path d="M3.5 9.5 12 4l8.5 5.5M5 10v7M9.7 10v7M14.3 10v7M19 10v7M3.5 19.5h17"/>', 'Banca'),
  /** ponte */
  bridge: wrap('<path d="M3 16c3-6 15-6 18 0M3 16v3M21 16v3M8 12.6V16M16 12.6V16M12 11.8V16"/>', 'Ponte'),
}
