/**
 * Guardia di navigazione.
 *
 * Il problema: una pagina lenta che arriva in ritardo scrive nel DOM di una
 * pagina che l'utente ha già lasciato. Riprodotto: con l'URL su #/token/B si
 * vedeva il contenuto di A, e i dati notturni di A comparivano sotto la pagella
 * di B con l'etichetta "Calcolo notturno". Per un explorer che promette di non
 * mostrare mai un dato di cui non è sicuro, è il peggiore dei difetti.
 *
 * La regola: ogni navigazione prende un numero; chi scrive nel DOM dopo un
 * `await` deve dimostrare di essere ancora la navigazione corrente.
 */
let gen = 0

/** Inizia una nuova navigazione e restituisce il suo numero. */
export function newNav(): number { return ++gen }

/** Vero se questa navigazione è ancora quella che l'utente sta guardando. */
export function isCurrent(g: number): boolean { return g === gen }

/** Il numero della navigazione in corso (per chi parte da un click, non dal router). */
export function currentNav(): number { return gen }
