# Fonti dati tariffari — Luce Check

Ultima verifica: 2026-07-13

## In uso (rilevanti per il calcolo domestico)

| Componente | Cadenza | Fonte ufficiale | Dove nel config | Stato |
|---|---|---|---|---|
| ASOS + ARIM domestici (classe 0) | Trimestrale | [Oneri generali di sistema](https://www.arera.it/area-operatori/prezzi-e-tariffe/oneri-generali-di-sistema-e-ulteriori-componenti) | `oneriSistema.quotaEnergia_eur_kWh`, `oneriSistema.quotaFissaNonResidente_eur_anno` | Verificato 2026-07-13 su delibera 227/2026/R/com. `quotaEnergia` corretta (0,033153). `quotaFissaNonResidente` era errata (90,64 → corretta a 95,09) |
| STG domestici non vulnerabili | Trimestrale | [Prezzi e tariffe](https://www.arera.it/area-operatori/prezzi-e-tariffe) | `stg.*` | Verificato tramite file caricato `E2026_stg_domesticiNonVulnerabili.xlsx` |
| Maggior Tutela Vulnerabili | Trimestrale | [Prezzi e tariffe](https://www.arera.it/area-operatori/prezzi-e-tariffe) | `maggiorTutelaVulnerabili.*` (nuovo blocco, da aggiungere) | Da integrare — file sorgente già disponibile: `E2026-smt.xlsx` |
| Tariffa TD domestici (σ1, σ2, σ3, UC3, UC6) | Annuale | [Trasmissione, distribuzione e misura clienti domestici](https://www.arera.it/area-operatori/prezzi-e-tariffe/tariffe-trasmissione-distribuzione-e-misura-clienti-domestici) | `rete.*` | Non ancora riverificato in questa sessione |
| Accisa e soglie esenzione (TUA Tab. A) | Rara (variazioni di legge) | Normativa, non ARERA | `imposte.*` | Non ancora riverificato in questa sessione |
| PUN mensile (F0-F3) | Mensile | energiachiara.it / dolomitienergia.it (GME richiede registrazione dal 15/10/2025) | `dati/pun.json` | Aggiornato 2026-07-13, copre gen 2025 - giu 2026 |

## Fuori scope (non serve integrarle, almeno finché Luce Check resta domestico BT)

| Fonte | Motivo esclusione |
|---|---|
| [Distribuzione non domestico](https://www.arera.it/area-operatori/prezzi-e-tariffe/distr) | Riguarda MT/AT e non domestico — fuori scope (fase 2) |
| [Corrispettivi dispacciamento ai BRP](https://www.arera.it/area-operatori/prezzi-e-tariffe/corrispettivi-per-gli-utenti-del-dispacciamento) / [dati.terna.it](https://dati.terna.it/corrispettivi) | Applicati a trader/venditori all'ingrosso, già inglobati nel prezzo dell'offerta o nel parametro dispacciamento STG |
| Tariffe di trasmissione RTTE (es. 575-2025-R-eel) | Per i domestici BT è già inglobata nella tariffa TD |
| Classi ASOS VALR1-3 / ASOS1-3 (energivori) | Solo per imprese a forte consumo — fuori scope |

## Automazione (roadmap, non ancora implementata)

Script di scraping proposto per ASOS/ARIM e STG (fonti più strutturate): scarica gli xlsx, estrae i valori, apre una Pull Request col diff — mai auto-merge. Vedi `ROADMAP.md`, sezione 2.
