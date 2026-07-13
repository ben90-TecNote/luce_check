/**
 * luce-check-extract — Cloudflare Worker per l'estrazione CTE via Anthropic API.
 *
 * DEPLOY (manuale, dashboard Cloudflare):
 *   1. Workers & Pages → luce-check-extract → Modifica codice → incolla questo file → Salva
 *      e distribuisci.
 *   2. Settings → Variables and Secrets → verifica che siano presenti (tipo "Secret"):
 *        ANTHROPIC_API_KEY   = chiave da console.anthropic.com (serve account API con
 *                              fatturazione attiva: un abbonamento consumer NON basta)
 *        SHARED_PASSPHRASE   = stringa a tua scelta (la stessa da inserire nell'app)
 *      Variabile normale (tipo "Text", facoltativa, usata solo come fallback se il client
 *      non specifica un modello):
 *        MODEL_ID            = modello di default. Verifica il nome corrente su
 *                              docs.claude.com prima del deploy.
 *   3. (Facoltativo, rate limit giornaliero) Storage & Databases → KV → namespace
 *      "luce-check-rl" già bindato come RATE_KV (se non c'è, il rate limit è disattivato).
 *   4. URL del Worker e passphrase vanno inseriti una volta nel pannello Impostazioni
 *      dell'app (toggle ON/OFF + selettore modello Haiku/Sonnet).
 *
 * SICUREZZA (limiti onesti): la passphrase viaggia nelle richieste del browser ed è
 * visibile a chi ispeziona la rete sul sito pubblico: è una barriera contro l'uso casuale,
 * NON una vera autenticazione. Le protezioni reali sono il rate limit KV e un alert di
 * budget sulla dashboard Anthropic.
 *
 * NOVITA' rispetto alla versione precedente: il client puo' scegliere il modello da usare
 * (Haiku 4.5, piu' economico, o Sonnet, piu' accurato) inviando il campo "model" nel body
 * della richiesta POST /extract: "haiku" | "sonnet". Se assente, si usa MODEL_ID (env) o
 * Sonnet come fallback finale. La risposta include "modelUsato" per riscontro lato UI.
 */

const ORIGIN_PERMESSA = "https://ben90-tecnote.github.io";
const LIMITE_GIORNALIERO = 50;          // richieste/giorno (se RATE_KV configurato)
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

const MODELLO_HAIKU = "claude-haiku-4-5-20251001";
const MODELLO_SONNET = "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin": ORIGIN_PERMESSA,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Luce-Check-Key",
};

const PROMPT_ESTRAZIONE = `Sei un motore di estrazione dati per CTE (Condizioni Tecnico Economiche) di offerte luce
domestiche italiane. Il PDF allegato è una CTE, Scheda Sintetica e/o Scheda di Confrontabilità
di un'offerta di energia elettrica (mercato libero o PLACET). Estrai UNA offerta nello schema
sottostante. Rispondi SOLO con un oggetto JSON valido, nessun testo prima o dopo, nessun blocco
markdown.

AMBITO: SOLO energia elettrica. Se il documento include anche gas naturale, ignora
completamente le sezioni gas — non estrarle, non mescolarle nei campi luce. Segnalalo in
"warnings" nella risposta di livello superiore (non dentro "offerta").

SCHEMA (schemaVersion=2):
- id: slug derivato dal nome offerta (minuscolo, trattini)
- nome: nome commerciale esatto
- fornitore: ragione sociale del venditore
- tipoPrezzo: "fisso" | "indicizzato"
- indice: "—" | "PUN" | "PUN Index GME" (usa "—" se tipoPrezzo="fisso")
- durataMesi: mesi di validità delle CONDIZIONI ECONOMICHE (blocco prezzo), es. "valide per i
  primi 12 mesi" o "valide per 24 mesi di fornitura". NON confondere con la finestra di
  sottoscrivibilità dell'offerta (quella va in "scadenza").
- scadenza: ultima data di sottoscrivibilità dell'offerta, formato YYYY-MM-DD. Se indeterminata
  o non specificata, usa null.
- biorariaDisp: true se esiste un'opzione bioraria (F1/F23 o F1/F2/F3) alternativa al monorario
- p0: prezzo mono €/kWh (per indicizzate: lo spread fisso da sommare all'indice)
- pF1, pF2, pF3: prezzo/spread di fascia se biorariaDisp=true, altrimenti 0. Se il documento usa
  solo F1/F23 (due fasce), replica lo stesso valore F23 sia in pF2 sia in pF3.
- prezzoConPerdite: true se il documento dichiara il prezzo "al lordo delle perdite di rete" o
  "comprensivo delle perdite"; false se "al netto delle perdite" (perdite applicate a parte).
  Se non specificato esplicitamente, usa false e segnala confidenza "bassa" su questo campo.
- perdite: coefficiente perdite di rete BT, es. 0.10 per 10%. Se non specificato, usa 0.10
  (valore standard BT) con confidenza "media".
- prezzoMax: tetto €/kWh sul prezzo energia (cerca frasi come "protezione sul Prezzo Luce",
  "il prezzo fatturato sarà al massimo pari a"). null se non presente.
- quotaFissa: corrispettivo fisso venditore in €/POD/anno. Se il documento indica solo un
  valore mensile (es. "6,00 €/mese"), moltiplica per 12 e usa il risultato annuale.
- dispIncluso: true SOLO se il documento dichiara esplicitamente che il dispacciamento (CDISPD)
  è incluso nel prezzo energia senza essere fatturato a parte. Diverso da "gratuito per il
  cliente perché il venditore lo assorbe" (in quel caso è comunque un corrispettivo distinto
  nella struttura — leggi con attenzione: se il documento mostra comunque una riga CDISPD con
  un valore in €/kWh separato dal prezzo energia, dispIncluso=false).
- scontoTipo: DEVE essere uno di questi valori chiusi, nessun altro:
  "—" | "perc_prezzo" | "eur_anno" | "eur_mese" | "bonus_unatantum"
  Se lo sconto descritto non rientra chiaramente in uno di questi, usa "—" e descrivi lo sconto
  in "note" invece di inventare un tipo nuovo.
- scontoValore: numero coerente col tipo (perc_prezzo: frazione es 0.05; eur_anno/eur_mese:
  importo €; bonus_unatantum: importo totale del bonus €)
- scontoCond: DEVE essere uno di questi valori chiusi, nessun altro:
  "—" | "domiciliazione" | "domiciliazione+eBill" | "dual_gas" | "telefonia_1mobile"
  Se la condizione reale non rientra in questi (es. un fornitore nuovo con una condizione
  diversa), usa "—" e descrivila per esteso in "note".
- scontoSuLuce: true se lo sconto riduce la bolletta LUCE; false se si applica altrove (es.
  quota fissa gas in un'offerta dual fuel).
- extra: null (usalo solo se ci sono chiaramente 2+ sconti indipendenti applicabili insieme;
  in tal caso array di oggetti {scontoTipo,scontoValore,scontoCond,scontoSuLuce})
- note: annotazioni utili, cautele, cosa non sei riuscito a determinare con certezza, eventuali
  costi di attivazione/voltura/recesso rilevanti, % energia rinnovabile.
- extractionConfidence: per ciascuno dei campi p0/pF1/pF2/pF3/prezzoConPerdite/perdite/
  prezzoMax/quotaFissa/durataMesi/scontoTipo/scontoCond, indica "alta"|"media"|"bassa".
  "bassa" quando hai dovuto interpretare/dedurre invece di leggere un valore esplicito.

GOLDEN POINTS (opzionale): se il documento contiene una tabella "Scheda di confrontabilità" o
"spesa annua stimata" con colonne potenza/tipo abitazione/consumo kWh/spesa annua dell'offerta,
estrai tutte le righe in un array goldenPoints separato (fuori da "offerta"):
[{"potenzaKw":3,"tipoAbitazione":"residenza|non_residenza","kWhAnno":2700,"spesaAnnuaOfferta":695.89}, ...]
Se la tabella non è presente, ometti il campo o usa null.

FORMATO RISPOSTA FINALE (oggetto root):
{
  "offerta": { ...come sopra... },
  "goldenPoints": [...] | null,
  "warnings": ["stringa", ...] | []
}

--- ESEMPIO 1 (fornitore: Enel Energia, prezzo fisso comprensivo perdite, bonus condizionato) ---
Input (estratto): "ENEL MOVE LUCE ... Prezzo Luce 0,17900 €/kWh ... Quota fissa 168 €/POD/anno
... Il Prezzo Luce è comprensivo delle perdite di rete ... pari al 10% del consumo ... Tutti i
corrispettivi ... hanno una validità di 24 mesi ... Bonus Dual: in caso di adesione ...
contestualmente all'offerta Enel Move Gas, troverà applicazione un bonus di 60€ ... riconosciuto
in due anni in quattro rate ..."

Output atteso:
{
  "offerta": {
    "schemaVersion": 2, "id": "enel-move-luce", "nome": "ENEL MOVE LUCE",
    "fornitore": "Enel Energia", "tipoPrezzo": "fisso", "indice": "—",
    "durataMesi": 24, "scadenza": "2026-07-28", "biorariaDisp": false,
    "p0": 0.179, "pF1": 0, "pF2": 0, "pF3": 0,
    "prezzoConPerdite": true, "perdite": 0.10, "prezzoMax": null,
    "quotaFissa": 168, "dispIncluso": false,
    "scontoTipo": "bonus_unatantum", "scontoValore": 60, "scontoCond": "dual_gas",
    "scontoSuLuce": true, "extra": null,
    "note": "Bonus Dual 60€ solo con Enel Move Gas, 4 rate da 15€ in 2 anni. 100% rinnovabile.",
    "extractionConfidence": {"p0":"alta","quotaFissa":"alta","prezzoConPerdite":"alta",
      "perdite":"alta","prezzoMax":"alta","durataMesi":"alta","scontoTipo":"alta","scontoCond":"alta"}
  },
  "goldenPoints": null,
  "warnings": []
}

--- ESEMPIO 2 (fornitore: Octopus Energy, indicizzato, con scheda di confrontabilità) ---
Input (estratto): "Octopus Fissa 12M ... Prezzo componente energia 0,1243 €/kWh ... Corrispettivo
di commercializzazione 72,00 €/anno per utenza (6,00 €/mese) ... al lordo delle perdite di rete,
IVA e imposte escluse ... Non sono previsti sconti o bonus ... [Scheda di confrontabilità] Cliente
con potenza impegnata 3 kW - contratto per abitazione di residenza: 1.500 → 460,47; 2.200 →
597,80; 2.700 → 695,89; 3.200 → 793,98 ... offerta valida per adesioni dal 07/07/2026 al
13/07/2026"

Output atteso:
{
  "offerta": {
    "schemaVersion": 2, "id": "octopus-fissa-12m", "nome": "OCTOPUS FISSA 12M",
    "fornitore": "Octopus Energy Italia", "tipoPrezzo": "fisso", "indice": "—",
    "durataMesi": 12, "scadenza": "2026-07-13", "biorariaDisp": false,
    "p0": 0.1243, "pF1": 0, "pF2": 0, "pF3": 0,
    "prezzoConPerdite": true, "perdite": 0.10, "prezzoMax": null,
    "quotaFissa": 72, "dispIncluso": false,
    "scontoTipo": "—", "scontoValore": 0, "scontoCond": "—", "scontoSuLuce": false, "extra": null,
    "note": "Nessuno sconto/bonus. 100% rinnovabile. Al rinnovo passa a tariffa Octopus Flex (PUN Index GME + 0,0088).",
    "extractionConfidence": {"p0":"alta","quotaFissa":"alta","prezzoConPerdite":"alta",
      "perdite":"alta","prezzoMax":"alta","durataMesi":"alta","scontoTipo":"alta","scontoCond":"alta"}
  },
  "goldenPoints": [
    {"potenzaKw":3,"tipoAbitazione":"residenza","kWhAnno":1500,"spesaAnnuaOfferta":460.47},
    {"potenzaKw":3,"tipoAbitazione":"residenza","kWhAnno":2200,"spesaAnnuaOfferta":597.80},
    {"potenzaKw":3,"tipoAbitazione":"residenza","kWhAnno":2700,"spesaAnnuaOfferta":695.89},
    {"potenzaKw":3,"tipoAbitazione":"residenza","kWhAnno":3200,"spesaAnnuaOfferta":793.98}
  ],
  "warnings": []
}

Ora estrai i dati dal PDF allegato seguendo esattamente questo schema e queste regole.`;

/* -------------------------------------------------------------------------- */

function rispostaJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** Rimuove eventuali fence ```json e fa il parse. */
function parseRisposta(testo) {
  const pulito = String(testo).replace(/```json|```/g, "").trim();
  return JSON.parse(pulito);
}

/** Risolve quale modello usare in base alla scelta del client ("haiku"|"sonnet"),
 *  con fallback a MODEL_ID (env) e infine a Sonnet come default finale. */
function risolviModello(env, richiesto) {
  if (richiesto === "haiku") return MODELLO_HAIKU;
  if (richiesto === "sonnet") return MODELLO_SONNET;
  return env.MODEL_ID || MODELLO_SONNET;
}

async function chiamaAnthropic(env, pdfBase64, messaggioExtra, modello) {
  const contenuto = [
    { type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    { type: "text", text: PROMPT_ESTRAZIONE },
  ];
  if (messaggioExtra) contenuto.push({ type: "text", text: messaggioExtra });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modello,
      max_tokens: 2000,
      messages: [{ role: "user", content: contenuto }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("Anthropic API " + resp.status + ": " +
    (data && data.error && data.error.message || "errore"));
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Rate limit giornaliero via KV (facoltativo: attivo solo se RATE_KV è bindato). */
async function verificaRateLimit(env) {
  if (!env.RATE_KV) return { ok: true };
  const chiave = "rl:" + new Date().toISOString().slice(0, 10);
  const n = parseInt((await env.RATE_KV.get(chiave)) || "0", 10);
  if (n >= LIMITE_GIORNALIERO) return { ok: false, n };
  await env.RATE_KV.put(chiave, String(n + 1), { expirationTtl: 172800 });
  return { ok: true, n: n + 1 };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/extract")
      return rispostaJson({ ok: false, error: "usa POST /extract" }, 404);

    // 1. passphrase: principale oppure "family" (secret separato, facoltativo).
    //    FAMILY_PASSPHRASE va aggiunta come secret nel dashboard (Settings → Variables
    //    and Secrets, tipo "Secret"); e' quella da dare ai familiari, cosi' la
    //    passphrase principale non viene mai condivisa ne' esposta.
    const chiave = request.headers.get("X-Luce-Check-Key");
    const chiaveOk = chiave === env.SHARED_PASSPHRASE ||
      (env.FAMILY_PASSPHRASE && chiave === env.FAMILY_PASSPHRASE);
    if (!chiaveOk)
      return rispostaJson({ ok: false, error: "passphrase mancante o errata" }, 401);

    // rate limit (prima della chiamata a pagamento)
    const rl = await verificaRateLimit(env);
    if (!rl.ok)
      return rispostaJson({ ok: false,
        error: `limite giornaliero raggiunto (${LIMITE_GIORNALIERO}/giorno)` }, 429);

    // 2. body e dimensione
    let body;
    try { body = await request.json(); }
    catch { return rispostaJson({ ok: false, error: "body JSON non valido" }, 400); }
    const pdfBase64 = body && body.pdfBase64;
    if (!pdfBase64 || typeof pdfBase64 !== "string")
      return rispostaJson({ ok: false, error: "pdfBase64 mancante" }, 400);
    if (pdfBase64.length * 0.75 > MAX_PDF_BYTES)
      return rispostaJson({ ok: false, error: "PDF oltre 15 MB" }, 413);

    const modelloScelto = risolviModello(env, body && body.model);

    // 3-4. chiamata + parse con un retry
    let grezzo = "";
    try {
      grezzo = await chiamaAnthropic(env, pdfBase64, null, modelloScelto);
      let dati;
      try { dati = parseRisposta(grezzo); }
      catch {
        grezzo = await chiamaAnthropic(env, pdfBase64,
          "Rispondi SOLO con l'oggetto JSON valido, nessun testo prima o dopo.", modelloScelto);
        try { dati = parseRisposta(grezzo); }
        catch { return rispostaJson({ ok: false, error: "parse", rawText: grezzo }); }
      }

      // 5. validazione minima di forma (quella completa la fa il client, validatore v2)
      const o = dati && dati.offerta;
      const num = (v) => typeof v === "number" && isFinite(v);
      if (!o || typeof o !== "object" || !o.nome || !o.tipoPrezzo ||
          !(num(o.p0) || num(o.pF1) || num(o.pF2) || num(o.pF3)))
        return rispostaJson({ ok: false,
          error: "estrazione incompleta: mancano nome/tipoPrezzo/prezzi", rawText: grezzo });

      return rispostaJson({
        ok: true,
        offerta: o,
        goldenPoints: Array.isArray(dati.goldenPoints) ? dati.goldenPoints : null,
        warnings: Array.isArray(dati.warnings) ? dati.warnings : [],
        modelUsato: modelloScelto,
      });
    } catch (e) {
      return rispostaJson({ ok: false, error: String(e.message || e),
        rawText: grezzo || undefined }, 502);
    }
  },
};
