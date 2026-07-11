/* ============================================================
 * CalcEngine - motore di calcolo bolletta domestica BT
 * Tutti i calcoli sono ANNUALIZZATI internamente; la vista
 * riproporziona al periodo scelto (mensile = annuo / 12).
 * ============================================================ */
"use strict";

const CalcEngine = {

  /** Normalizza l'input consumi in kWh ANNUI per fascia.
   *  input: { periodo:'mensile'|'annuale', multiorario:bool,
   *           kWh:{F0} | {F1,F2,F3} }                          */
  normalizzaConsumi(input) {
    const molt = input.periodo === "mensile" ? 12 : 1;
    let fasce;
    if (input.multiorario) {
      fasce = {
        F1: (input.kWh.F1 || 0) * molt,
        F2: (input.kWh.F2 || 0) * molt,
        F3: (input.kWh.F3 || 0) * molt,
      };
    } else {
      fasce = { F0: (input.kWh.F0 || 0) * molt };
    }
    const totale = Object.values(fasce).reduce((a, b) => a + b, 0);
    return { fasce, totale, mensile: totale / 12 };
  },

  /** Spesa materia energia MERCATO LIBERO (annua).
   *  Perdite di rete applicate SOLO qui (Loop 2).              */
  materiaMercatoLibero(consumi, offerta, pun) {
    const fattorePerdite = offerta.prezzoComprensivoPerdite
      ? 1 : (1 + offerta.perdite);
    let energia = 0;
    const dettaglioFasce = {};
    for (const [f, kwh] of Object.entries(consumi.fasce)) {
      const prezzo = offerta.tipoPrezzo === "fisso"
        ? offerta.prezzoFisso
        : (pun[f] ?? pun.F0) + offerta.spread;
      const voce = prezzo * kwh * fattorePerdite;
      dettaglioFasce[f] = { prezzo, kwh, importo: voce };
      energia += voce;
    }
    return {
      quotaFissa: offerta.quotaFissa,
      energia,
      totale: offerta.quotaFissa + energia,
      dettaglioFasce,
    };
  },

  /** Spesa materia energia STG (annua): gamma + PUN ex post
   *  con perdite + CPSTGD.                                     */
  materiaSTG(consumi, cfgStg, pun) {
    let energia = 0;
    const dettaglioFasce = {};
    for (const [f, kwh] of Object.entries(consumi.fasce)) {
      const prezzo = (pun[f] ?? pun.F0) * (1 + cfgStg.perditeRete);
      const voce = prezzo * kwh;
      dettaglioFasce[f] = { prezzo, kwh, importo: voce };
      energia += voce;
    }
    energia += cfgStg.cpstgd_eur_kWh * consumi.totale;
    return {
      quotaFissa: cfgStg.parametroGamma_eur_pod_anno,
      energia,
      totale: cfgStg.parametroGamma_eur_pod_anno + energia,
      dettaglioFasce,
    };
  },

  /** Dispacciamento (annuo). Se perditeIncluse, si applica ai
   *  kWh misurati senza rimoltiplicare per (1+lambda).         */
  dispacciamento(consumi, cfgStg) {
    const kwh = cfgStg.dispacciamentoPerditeIncluse
      ? consumi.totale
      : consumi.totale * (1 + cfgStg.perditeRete);
    return cfgStg.dispacciamento_eur_kWh * kwh;
  },

  /** Trasporto e gestione contatore (annuo).
   *  Tabelle ARERA in EUR/MESE -> x12 (Loop 1).                */
  rete(consumi, potenzaKw, cfgRete) {
    const quotaFissa   = cfgRete.quotaFissa_eur_mese * 12;
    const quotaPotenza = cfgRete.quotaPotenza_eur_kW_mese * potenzaKw * 12;
    const quotaEnergia = cfgRete.quotaEnergia_eur_kWh * consumi.totale;
    return { quotaFissa, quotaPotenza, quotaEnergia,
             totale: quotaFissa + quotaPotenza + quotaEnergia };
  },

  /** Oneri di sistema (annuo). Quota fissa solo non residenti;
   *  quota energia sui kWh MISURATI (no perdite - Loop 2).     */
  oneri(consumi, residente, cfgOneri) {
    const quotaFissa = residente ? 0 : cfgOneri.quotaFissaNonResidente_eur_anno;
    const quotaEnergia = cfgOneri.quotaEnergia_eur_kWh * consumi.totale;
    return { quotaFissa, quotaEnergia, totale: quotaFissa + quotaEnergia };
  },

  /** Accisa (annua) con agevolazione residenti <= 3 kW:
   *  primi 150 kWh/mese esenti; recupero progressivo 1:1
   *  oltre 220 kWh/mese (TUA, Tabella A punto 13).             */
  accisa(consumi, residente, potenzaKw, cfgImposte) {
    const cm = consumi.mensile;
    const ag = cfgImposte.esenzioneResidente;
    let imponibileMese;
    if (residente && potenzaKw <= ag.potenzaMax_kW) {
      if (cm <= ag.kWhMese) {
        imponibileMese = 0;
      } else if (cm <= ag.sogliaRecupero_kWhMese) {
        imponibileMese = cm - ag.kWhMese;
      } else {
        const esenzioneResidua =
          Math.max(0, ag.kWhMese - (cm - ag.sogliaRecupero_kWhMese));
        imponibileMese = cm - esenzioneResidua;
      }
    } else {
      imponibileMese = cm;
    }
    return imponibileMese * cfgImposte.accisa_eur_kWh * 12;
  },

  /** Bolletta completa (annua). tipo: 'ml' | 'stg'             */
  bolletta(tipo, input, offerta, config, pun) {
    const consumi = this.normalizzaConsumi(input);
    const materia = tipo === "ml"
      ? this.materiaMercatoLibero(consumi, offerta, pun)
      : this.materiaSTG(consumi, config.stg, pun);
    const disp   = this.dispacciamento(consumi, config.stg);
    const rete   = this.rete(consumi, input.potenzaKw, config.rete);
    const oneri  = this.oneri(consumi, input.residente, config.oneriSistema);
    const accisa = this.accisa(consumi, input.residente, input.potenzaKw,
                               config.imposte);
    const imponibile = materia.totale + disp + rete.totale
                     + oneri.totale + accisa;
    const iva = imponibile * config.imposte.iva;
    const totale = imponibile + iva;
    // Loop 3 - match del fatturato: verifica di quadratura
    const check = Math.abs(
      totale - (materia.totale + disp + rete.totale + oneri.totale
                + accisa + iva)) < 1e-9;
    return { consumi, materia, dispacciamento: disp, rete, oneri,
             accisa, iva, imponibile, totale, quadraturaOk: check };
  },
};

if (typeof module !== "undefined") module.exports = CalcEngine;
