# Luce Check

Simulatore di bolletta elettrica domestica (CTE mercato libero vs Servizio a Tutele Graduali). Single-file HTML, stile TecNote, senza build.

## Deploy (come TecNote)

1. Crea un repo pubblico su GitHub (es. `bolletta-radar`) e carica tutto il contenuto di questa cartella.
2. Settings → Pages → deploy from branch `main`, cartella `/ (root)`.
3. Settings → Actions → General → Workflow permissions → **Read and write** (serve al bot per committare `dati/pun.json`).
4. Actions → "Aggiorna PUN da GME" → **Run workflow** per il primo popolamento.

## Aggiornamenti

- **PUN (automatico):** la Action gira ogni lunedì (mese corrente parziale) e il giorno 2 di ogni mese (mese precedente consolidato). Scarica i prezzi orari MGP dal GME, calcola le medie F0/F1/F2/F3 con il calendario festività italiano e committa `dati/pun.json`.
- **Tariffe ARERA (manuale + promemoria):** ogni trimestre aggiorna `config_tariffe.json` dalle tabelle SEN/ARERA. Quando `meta.validoAl` è superato, l'app mostra il badge/avviso "tariffe scadute" e la Action emette un warning nel log.

## Fonti trimestrali per l'aggiornamento manuale

- Tariffe rete/oneri: https://www.servizioelettriconazionale.it/it-IT/tariffe/uso-domestico
- Componenti STG (PD, CPSTGD, parametro γ): https://www.arera.it/consumatori/valori-della-materia-energia-per-il-servizio-a-tutele-graduali

## File

- `index.html` — app completa (TariffManager + CalcEngine + UI + Chart.js)
- `config_tariffe.json` — scheletro gerarchico tariffe ARERA (Q3 2026)
- `dati/pun.json` — medie mensili PUN, rigenerato dalla Action
- `scripts/aggiorna_pun.py` — data fetcher GME
- `engine.js` — motore di calcolo standalone con test (sviluppo)

## Note di calcolo

- Perdite di rete applicate solo alla materia energia; rete, oneri e accise sui kWh misurati.
- Quote fisse/potenza ARERA in €/mese → ×12 per l'annuo; input mensile → ×12 internamente e vista /12.
- Accisa: esenzione 150 kWh/mese per residenti ≤3 kW con recupero progressivo oltre 220 kWh/mese (TUA).
- IVA 10% su tutto l'imponibile, accisa inclusa.
