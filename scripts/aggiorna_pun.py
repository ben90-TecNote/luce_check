#!/usr/bin/env python3
"""
aggiorna_pun.py - Inserimento manuale guidato del PUN mensile in dati/pun.json.

STORIA: la versione originale scaricava i prezzi orari dal GME via libreria
`mercati-energetici`; dal 15/10/2025 il GME richiede registrazione ufficiale e
quel flusso e' morto. L'aggiornamento oggi e' MANUALE: le medie mensili F0/F1/F2/F3
si leggono da energiachiara.it o dolomitienergia.it (verificarle incrociate) e si
inseriscono con questo script, che valida e riscrive il file ordinato.

USO:
  Inserire un mese:   python scripts/aggiorna_pun.py 2026-06 0.132505 0.12576 0.15170 0.12724
                      (ordine: F0 F1 F2 F3, in eur/kWh)
  Solo controllo:     python scripts/aggiorna_pun.py --check
                      Esce con codice 1 se manca il mese precedente (usato dalla
                      GitHub Action per il promemoria mensile).
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

PUN_JSON = Path(__file__).resolve().parent.parent / "dati" / "pun.json"


def carica() -> dict:
    return json.loads(PUN_JSON.read_text(encoding="utf-8"))


def salva(dati: dict) -> None:
    dati["mesi"] = dict(sorted(dati["mesi"].items()))
    dati["meta"]["ultimoAggiornamento"] = date.today().isoformat()
    PUN_JSON.write_text(json.dumps(dati, indent=4, ensure_ascii=False) + "\n",
                        encoding="utf-8")


def mese_precedente(oggi: date) -> str:
    prec = oggi.replace(day=1)
    prec = prec.replace(year=prec.year - 1, month=12) if prec.month == 1 \
        else prec.replace(month=prec.month - 1)
    return f"{prec.year:04d}-{prec.month:02d}"


def check() -> int:
    dati = carica()
    atteso = mese_precedente(date.today())
    presenti = sorted(dati["mesi"])
    print(f"pun.json: {len(presenti)} mesi, ultimo = {presenti[-1]}")
    if atteso not in dati["mesi"]:
        print(f"MANCA il mese {atteso}: aggiornare a mano da "
              f"energiachiara.it / dolomitienergia.it e inserirlo con questo script.")
        return 1
    print(f"OK: il mese precedente ({atteso}) e' presente.")
    return 0


def inserisci(mese: str, valori: list[str]) -> int:
    if not re.fullmatch(r"\d{4}-\d{2}", mese):
        print(f"Mese '{mese}' non valido: atteso YYYY-MM.")
        return 1
    try:
        f0, f1, f2, f3 = (float(v.replace(",", ".")) for v in valori)
    except ValueError:
        print("Valori non numerici: attesi 4 numeri (F0 F1 F2 F3) in eur/kWh.")
        return 1
    for nome, v in zip(("F0", "F1", "F2", "F3"), (f0, f1, f2, f3)):
        if not 0.01 <= v <= 1.0:  # sanity check: eur/kWh, non eur/MWh
            print(f"{nome}={v} fuori range plausibile (0.01-1.0 eur/kWh). "
                  f"Hai inserito eur/MWh per errore?")
            return 1
    dati = carica()
    if mese in dati["mesi"]:
        print(f"Il mese {mese} esiste gia' ({dati['mesi'][mese]}): sovrascrivo.")
    dati["mesi"][mese] = {"F0": f0, "F1": f1, "F2": f2, "F3": f3}
    salva(dati)
    print(f"Inserito {mese}: F0={f0} F1={f1} F2={f2} F3={f3}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--check":
        sys.exit(check())
    if len(sys.argv) == 6:
        sys.exit(inserisci(sys.argv[1], sys.argv[2:6]))
    print(__doc__)
    sys.exit(2)
