#!/usr/bin/env python3
"""
aggiorna_pun.py - Data fetcher PUN Index GME per Simulatore Bolletta.

Scarica i prezzi orari MGP dal GME (via libreria `mercati-energetici`),
calcola le medie mensili totali (F0) e per fascia ARERA (F1/F2/F3)
e riscrive dati/pun.json mantenendo lo storico.

Eseguito da GitHub Actions (vedi .github/workflows/aggiorna_pun.yml).
Uso manuale:  python scripts/aggiorna_pun.py [YYYY-MM]
              (default: mese precedente + mese corrente parziale)

NOTA LICENZA GME: l'uso dei dati implica l'accettazione delle condizioni
generali GME (la libreria le espone con get_general_conditions()).
Uso personale/non commerciale.
"""

import asyncio
import json
import sys
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path

from mercati_energetici import MGP

PUN_JSON = Path(__file__).resolve().parent.parent / "dati" / "pun.json"

# ---------------------------------------------------------------- festività

def pasquetta(anno: int) -> date:
    """Lunedì dell'Angelo con l'algoritmo di Gauss/Butcher."""
    a, b, c = anno % 19, anno // 100, anno % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mese = (h + l - 7 * m + 114) // 31
    giorno = (h + l - 7 * m + 114) % 31 + 1
    return date(anno, mese, giorno) + timedelta(days=1)


def festivi_nazionali(anno: int) -> set[date]:
    fissi = [(1, 1), (1, 6), (4, 25), (5, 1), (6, 2),
             (8, 15), (11, 1), (12, 8), (12, 25), (12, 26)]
    giorni = {date(anno, m, g) for m, g in fissi}
    giorni.add(pasquetta(anno))
    return giorni


# ------------------------------------------------------------- fasce ARERA

def fascia(giorno: date, ora: int, festivi: set[date]) -> str:
    """Classificazione fasce del. ARERA 181/06:
    F1: lun-ven 8-19 (esclusi festivi)
    F2: lun-ven 7-8 e 19-23; sabato 7-23 (esclusi festivi)
    F3: lun-sab 23-7; domeniche e festivi tutte le ore
    `ora` è l'ora di inizio (0-23)."""
    dow = giorno.weekday()  # 0=lun ... 6=dom
    if dow == 6 or giorno in festivi:
        return "F3"
    if dow == 5:  # sabato
        return "F2" if 7 <= ora < 23 else "F3"
    if 8 <= ora < 19:
        return "F1"
    if ora == 7 or 19 <= ora < 23:
        return "F2"
    return "F3"


# ------------------------------------------------------------------ fetch

async def medie_mese(anno: int, mese: int) -> dict | None:
    """Media aritmetica dei prezzi orari PUN del mese, totale e per fascia.
    Restituisce None se il mese non ha ancora dati."""
    festivi = festivi_nazionali(anno)
    somme = {"F0": 0.0, "F1": 0.0, "F2": 0.0, "F3": 0.0}
    conte = {"F0": 0, "F1": 0, "F2": 0, "F3": 0}

    async with MGP() as mgp:
        # Accettazione condizioni d'uso GME richiesta dalla libreria
        await mgp.get_general_conditions()
        await mgp.get_disclaimer()

        ultimo = min(date(anno, mese, monthrange(anno, mese)[1]), date.today())
        g = date(anno, mese, 1)
        while g <= ultimo:
            try:
                orari = await mgp.get_prices(g)  # {ora: eur/MWh}
            except Exception as exc:  # giorno mancante: salto
                print(f"  ! {g}: {exc}", file=sys.stderr)
                g += timedelta(days=1)
                continue
            for ora, prezzo_mwh in orari.items():
                f = fascia(g, int(ora), festivi)
                for chiave in ("F0", f):
                    somme[chiave] += float(prezzo_mwh)
                    conte[chiave] += 1
            g += timedelta(days=1)

    if conte["F0"] == 0:
        return None
    # eur/MWh -> eur/kWh, 6 decimali
    return {k: round(somme[k] / conte[k] / 1000.0, 6)
            for k in somme if conte[k] > 0}


async def main() -> None:
    oggi = date.today()
    if len(sys.argv) > 1:  # mese esplicito YYYY-MM
        anno, mese = map(int, sys.argv[1].split("-"))
        target = [(anno, mese)]
    else:  # mese precedente completo + mese corrente parziale
        prec = (oggi.replace(day=1) - timedelta(days=1))
        target = [(prec.year, prec.month), (oggi.year, oggi.month)]

    dati = json.loads(PUN_JSON.read_text(encoding="utf-8")) if PUN_JSON.exists() \
        else {"meta": {}, "mesi": {}}

    for anno, mese in target:
        chiave = f"{anno:04d}-{mese:02d}"
        print(f"Elaboro {chiave}...")
        medie = await medie_mese(anno, mese)
        if medie:
            if (anno, mese) == (oggi.year, oggi.month):
                medie["parziale"] = True
            dati["mesi"][chiave] = medie
            print(f"  -> {medie}")
        else:
            print(f"  -> nessun dato per {chiave}")

    dati["meta"] = {
        "fonte": "GME - MGP/PUN Index (medie aritmetiche orarie per fascia ARERA)",
        "unita": "eur/kWh",
        "ultimoAggiornamento": oggi.isoformat(),
    }
    dati["mesi"] = dict(sorted(dati["mesi"].items()))
    PUN_JSON.write_text(json.dumps(dati, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(f"Scritto {PUN_JSON}")


if __name__ == "__main__":
    asyncio.run(main())
