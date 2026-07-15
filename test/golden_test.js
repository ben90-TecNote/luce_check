#!/usr/bin/env node
/* golden_test.js — estrae il motore da ../index.html e verifica:
 * Tier 1: materia esatta (±0,01 €) per le offerte a prezzo fisso + formula indicizzate + cap
 * Tier 2: full-bill esclusa imposte vs scheda confrontabilità CASA FLEX (snapshot, ±1%)
 * Extra: sconti pre/post IVA, condizioni ctx, validazione enum/quarantena, migrazione v1
 */
"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

/* estrae le sezioni pure (senza DOM) e le valuta su globalThis */
function sezione(da,a){
  const i=src.indexOf(da);const j=src.indexOf(a,i);
  return src.slice(i,j);
}
let codice=sezione("const ENUMS","/* ================= Stato & UI");
codice=codice.replace(/const (ENUMS|CONDIZIONI|CONDIZIONI_LABEL|CalcEngine|CteParser|OfferStore|SEED|XLSX_COLONNE)=/g,
  "globalThis.$1=");
codice=codice.replace(/function (validaOfferta|migraV1|statoScadenza|esportaXlsx|importaXlsx|normalizzaRecordImport|importaConQuarantena|deepMerge|leggiTariffOverride)\(/g,
  "globalThis.$1=function(");
eval(codice);

const snap=JSON.parse(fs.readFileSync(path.join(__dirname,"golden_snapshot.json"),"utf8"));
const seed=Object.fromEntries(SEED.map(o=>[o.id,o]));
let passati=0;
function ok(nome,cond,dett){ if(!cond){console.error("✗ "+nome+(dett?" — "+dett:""));process.exit(1);}
  console.log("✓ "+nome);passati++; }

/* config live (solo per test unitari non-snapshot) */
const cfgLive=JSON.parse(fs.readFileSync(path.join(__dirname,"..","config_tariffe.json"),"utf8"));
const inp2700={periodo:"annuale",multiorario:false,kWh:{F0:2700},potenzaKw:3,residente:true};

/* ============ OFFERTE FITTIZIE (solo per test del motore, NON nel catalogo) ============
   Servono a testare comportamenti generici (sconti, validazione, cap) senza
   dipendere dalle offerte reali in SEED, che possono cambiare/essere rimosse. */
const FIT_fissa5pct={schemaVersion:2,id:"_fit_fissa5pct",nome:"[fittizia] fissa 5%",fornitore:"—",
  tipoPrezzo:"fisso",indice:"—",durataMesi:24,scadenza:"2099-01-01",
  biorariaDisp:true,p0:0.09,pF1:0.0925,pF2:0.0885,pF3:0.0885,prezzoConPerdite:false,perdite:0.10,
  prezzoMax:null,quotaFissa:144,dispIncluso:false,scontoTipo:"perc_prezzo",scontoValore:0.05,
  scontoCond:"domiciliazione",scontoSuLuce:true,extra:null,note:"fittizia per test motore"};
const FIT_fissaNetCap={schemaVersion:2,id:"_fit_fissaNetCap",nome:"[fittizia] fissa cap netto",fornitore:"—",
  tipoPrezzo:"fisso",indice:"—",durataMesi:24,scadenza:"2099-01-01",
  biorariaDisp:false,p0:0.10,pF1:0,pF2:0,pF3:0,prezzoConPerdite:false,perdite:0.10,
  prezzoMax:0.105,quotaFissa:144,dispIncluso:false,scontoTipo:"—",scontoValore:0,
  scontoCond:"—",scontoSuLuce:true,extra:null,note:"fittizia per test motore"};
const FIT_bonus={schemaVersion:2,id:"_fit_bonus",nome:"[fittizia] bonus dual",fornitore:"—",
  tipoPrezzo:"fisso",indice:"—",durataMesi:24,scadenza:"2099-01-01",
  biorariaDisp:false,p0:0.179,pF1:0,pF2:0,pF3:0,prezzoConPerdite:true,perdite:0.10,
  prezzoMax:null,quotaFissa:168,dispIncluso:false,scontoTipo:"bonus_unatantum",scontoValore:60,
  scontoCond:"dual_gas",scontoSuLuce:true,extra:null,note:"fittizia per test motore"};
const FIT_nonLuce={schemaVersion:2,id:"_fit_nonluce",nome:"[fittizia] sconto non-luce",fornitore:"—",
  tipoPrezzo:"indicizzato",indice:"PUN Index GME",durataMesi:24,scadenza:"2099-01-01",
  biorariaDisp:false,p0:0.02,pF1:0,pF2:0,pF3:0,prezzoConPerdite:false,perdite:0.10,
  prezzoMax:null,quotaFissa:144,dispIncluso:false,scontoTipo:"eur_anno",scontoValore:12,
  scontoCond:"domiciliazione",scontoSuLuce:false,extra:null,note:"fittizia per test motore"};
const FIT_indicizzataCap={schemaVersion:2,id:"_fit_indicizzataCap",nome:"[fittizia] indicizzata con cap",fornitore:"—",
  tipoPrezzo:"indicizzato",indice:"PUN Index GME",durataMesi:12,scadenza:"2099-01-01",
  biorariaDisp:false,p0:0.02226,pF1:0,pF2:0,pF3:0,prezzoConPerdite:true,perdite:0.10,
  prezzoMax:0.174,quotaFissa:180,dispIncluso:false,scontoTipo:"—",scontoValore:0,
  scontoCond:"—",scontoSuLuce:false,extra:null,note:"fittizia per test motore"};

/* ============ TIER 1 — materia esatta (±0,01) ============ */
console.log("— Tier 1 (materia, 2700 kWh/anno monorario) —");
const punX={F0:0.111};
function materia(id,pun){return CalcEngine.bolletta("ml",inp2700,seed[id],cfgLive,pun||punX).materia.totale;}
function materiaOff(off,pun){return CalcEngine.bolletta("ml",inp2700,off,cfgLive,pun||punX).materia.totale;}
/* indicizzate: formula col PUN F0 di pun.json */
const punJson=JSON.parse(fs.readFileSync(path.join(__dirname,"..","dati","pun.json"),"utf8"));
const mesi=Object.keys(punJson.mesi).sort();
const P=punJson.mesi[mesi[mesi.length-1]].F0;
ok("CASA FLEX formula",
  Math.abs(materia("1mob-casaflex",{F0:P})-(207.6+(P+0.01991)*2700*1.10))<=0.01);
ok("indicizzata con cap: formula (senza cap)",
  Math.abs(materiaOff(FIT_indicizzataCap,{F0:P})-(180+Math.min(P+0.02226,0.174)*2700))<=0.01);
/* test del cap: PUN fittizio 0,16 -> 0,18226 clampato a 0,174 */
const mCap=materiaOff(FIT_indicizzataCap,{F0:0.16});
ok("indicizzata con cap: cap attivo (PUN 0,16)",Math.abs(mCap-(180+0.174*2700))<=0.01,mCap);
/* cap con prezzo netto perdite: clamp sul lordo */
const mNC=materiaOff(FIT_fissaNetCap);
ok("cap su prezzo netto: min(0,10×1,10;0,105)",Math.abs(mNC-(144+0.105*2700))<=0.01,mNC);

/* ============ SCONTI (modello checkbox: default miglior caso) ============ */
console.log("— Sconti: obbligatori/opzionali, checkbox —");
const iva=cfgLive.imposte.iva;
/* fittizia fissa 5%: condizionato domiciliazione -> opzionale, applicato di default */
const bDef=CalcEngine.bolletta("ml",inp2700,FIT_fissa5pct,cfgLive,punX);
const attesoSc=0.05*(0.09*2700*1.10);
ok("sconto opzionale applicato di default (miglior caso)",
  Math.abs(bDef.sconti.preIVA-attesoSc)<1e-9&&bDef.sconti.attivi[0].obbligatorio===false);
/* deseleziono la checkbox -> escluso, totale sale di sconto*(1+IVA) */
const bOff=CalcEngine.bolletta("ml",inp2700,FIT_fissa5pct,cfgLive,punX,new Set(["flat"]));
ok("sconto deselezionato: escluso e tracciato in disattivati",
  bOff.sconti.preIVA===0&&bOff.sconti.disattivati.length===1
  &&Math.abs(bOff.sconti.disattivati[0].valore-attesoSc)<1e-9);
ok("IVA sul netto: delta totale = sconto x (1+IVA)",
  Math.abs((bOff.totale-bDef.totale)-attesoSc*(1+iva))<1e-9);
/* condizione inclusa nei requisiti obbligatori -> sempre applicato, checkbox ignorata */
const offObb={...FIT_fissa5pct,requisitoObbligatorio:["domiciliazione"]};
const bObb=CalcEngine.bolletta("ml",inp2700,offObb,cfgLive,punX,new Set(["flat"]));
ok("sconto con condizione obbligatoria: sempre incluso",
  Math.abs(bObb.sconti.preIVA-attesoSc)<1e-9&&bObb.sconti.attivi[0].obbligatorio===true);
/* fittizia bonus dual: 60 su 24 mesi -> 30 EUR/anno post-IVA, default applicato */
const bDual=CalcEngine.bolletta("ml",inp2700,FIT_bonus,cfgLive,punX);
const bDualOff=CalcEngine.bolletta("ml",inp2700,FIT_bonus,cfgLive,punX,new Set(["flat"]));
ok("bonus_unatantum 60/24 mesi = 30 EUR/anno post-IVA",
  Math.abs(bDual.sconti.postIVA-30)<1e-9&&Math.abs((bDualOff.totale-bDual.totale)-30)<1e-9);
/* CASA FLEX (reale, in catalogo): eur_mese 11 -> 132 pre-IVA */
const bSim=CalcEngine.bolletta("ml",inp2700,seed["1mob-casaflex"],cfgLive,punX);
ok("eur_mese 11 x12 = 132 pre-IVA",Math.abs(bSim.sconti.preIVA-132)<1e-9);
/* fittizia non-luce: sconto non su luce -> mai conteggiato, in nonLuce */
const bNonLuce=CalcEngine.bolletta("ml",inp2700,FIT_nonLuce,cfgLive,punX);
ok("scontoSuLuce=false in nonLuce, mai applicato",
  bNonLuce.sconti.preIVA===0&&bNonLuce.sconti.nonLuce.length===1);
ok("quadraturaOk",bDef.quadraturaOk&&bDual.quadraturaOk);
/* extra[]: chiave separata, disattivabile indipendentemente */
const offExtra={...FIT_fissa5pct,
  extra:[{scontoTipo:"eur_anno",scontoValore:10,scontoCond:"—",scontoSuLuce:true}]};
const bEx=CalcEngine.bolletta("ml",inp2700,offExtra,cfgLive,punX);
const bEx2=CalcEngine.bolletta("ml",inp2700,offExtra,cfgLive,punX,new Set(["flat"]));
ok("extra[] sommato; extra con cond '—' resta obbligatorio",
  Math.abs(bEx.sconti.preIVA-(attesoSc+10))<1e-9&&Math.abs(bEx2.sconti.preIVA-10)<1e-9);

/* ============ VALIDAZIONE / QUARANTENA ============ */
console.log("— Validazione —");
ok("seed tutte valide",SEED.every(o=>validaOfferta(o).ok));
ok("enum fuori vocabolario rifiutato",
  !validaOfferta({...FIT_fissa5pct,scontoCond:"xyz"}).ok);
ok("indicizzato senza indice rifiutato",
  !validaOfferta({...seed["1mob-casaflex"],indice:"—"}).ok);
ok("perc_prezzo fuori [0,1) rifiutato",
  !validaOfferta({...FIT_fissa5pct,scontoValore:1.5}).ok);
ok("scadenza malformata rifiutata",
  !validaOfferta({...FIT_fissa5pct,scadenza:"28/07/2026"}).ok);
ok("durataMesi 36 rifiutata",
  !validaOfferta({...FIT_fissa5pct,durataMesi:36}).ok);
/* migrazione v1 */
const v1={id:"x",nome:"VECCHIA",tipoPrezzo:"indicizzato",p0:0.02,quotaFissa:100,
  perdite:0.10,prezzoConPerdite:false,dispIncluso:false,perFasce:true,altriVar:0.005,sconto:24};
const mig=migraV1(v1);
ok("migrazione v1: sconto->eur_anno, perFasce->biorariaDisp, indice default",
  validaOfferta(mig).ok&&mig.scontoTipo==="eur_anno"&&mig.scontoValore===24
  &&mig.scontoSuLuce===true&&mig.biorariaDisp===true&&mig.indice==="PUN"&&mig.schemaVersion===2);
/* import xlsx record retrocompat */
const rec=normalizzaRecordImport({nome:"IMP",tipoPrezzo:"fisso",p0:"0,15",quotaFissa:"120",
  perdite:"0.1",perFasce:"TRUE",sconto:"18",scadenza:"31/12/2026",prezzoConPerdite:"1"});
ok("import: virgole, TRUE/1, data it->ISO, sconto v1",
  rec.p0===0.15&&rec.biorariaDisp===true&&rec.prezzoConPerdite===true
  &&rec.scadenza==="2026-12-31"&&rec.scontoTipo==="eur_anno"&&rec.scontoValore===18
  &&validaOfferta(rec).ok);

/* ============ REQUISITI OBBLIGATORI (validazione) + MTV ============ */
console.log("— Requisiti obbligatori / MTV —");
ok("requisito valido accettato",
  validaOfferta({...FIT_fissa5pct,requisitoObbligatorio:["domiciliazione"]}).ok);
ok("requisito fuori enum rifiutato",
  !validaOfferta({...FIT_fissa5pct,requisitoObbligatorio:["carta_credito"]}).ok);
ok("requisito non-array rifiutato",
  !validaOfferta({...FIT_fissa5pct,requisitoObbligatorio:"domiciliazione"}).ok);
ok("migrazione v1 aggiunge requisitoObbligatorio []",
  Array.isArray(migraV1({nome:"X",tipoPrezzo:"fisso",p0:0.1,quotaFissa:100,perdite:0.1}).requisitoObbligatorio));
const recReq=normalizzaRecordImport({nome:"R",tipoPrezzo:"fisso",p0:"0,1",quotaFissa:"100",
  perdite:"0.1",requisitoObbligatorio:"domiciliazione|dual_gas|xyz"});
ok("import xlsx: requisiti da pipe, invalidi scartati",
  recReq.requisitoObbligatorio.length===2&&validaOfferta(recReq).ok);
/* MTV: materia = fisso trimestrale per fascia + quota fissa annua (PCV+DISPbt),
   niente dispacciamento separato (gia' incluso). Quota fissa confermata da
   bolletta reale mag-giu 2026 (44,7311 per quel trimestre) e da fonte ARERA
   ufficiale lug-set 2026 (42,287 - vedi test/golden_snapshot.json fonte). */
const bMtv=CalcEngine.bolletta("mtv",inp2700,null,cfgLive,punX);
ok("MTV monorario: materia = 42,287 + 0,16913 x kWh, disp=0",
  Math.abs(bMtv.materia.totale-(42.287+0.16913*2700))<1e-6
  &&bMtv.materia.quotaFissa===42.287&&bMtv.dispacciamento===0);
const bMtvM=CalcEngine.bolletta("mtv",{...inp2700,multiorario:true,kWh:{F1:1200,F2:800,F3:700}},null,cfgLive,punX);
ok("MTV multiorario: F1 e F23",
  Math.abs(bMtvM.materia.energia-(0.15977*1200+0.1741*1500))<1e-9);
/* verifica del brief: materia energia+rete QE+oneri QE (esclusa quota fissa) = 0,217013 */
ok("coerenza 0,16913+0,01473+0,033153 = 0,217013 EUR/kWh",
  Math.abs(0.16913+cfgLive.rete.quotaEnergia_eur_kWh
    +cfgLive.oneriSistema.quotaEnergia_eur_kWh-0.217013)<1e-9);

console.log("— Tier 2 MTV ufficiale (fonte ARERA diretta, indipendente da fornitore) —");
for(const p of snap.puntiMtv.punti){
  const inp={periodo:"annuale",multiorario:false,kWh:{F0:p.kWh},
    potenzaKw:p.kW,residente:p.residente};
  const b=CalcEngine.bolletta("mtv",inp,null,cfgLive,punX);
  const esclImposte=b.materia.totale+b.dispacciamento+b.rete.totale+b.oneri.totale;
  const err=Math.abs(esclImposte-p.attesoEsclImposte)/p.attesoEsclImposte;
  ok(`  MTV ${p.kWh} kWh ${p.kW} kW ${p.residente?"res":"nonres"} -> ${esclImposte.toFixed(2)} vs ${p.attesoEsclImposte}`,
    err<=0.01,esclImposte);
}

/* ============ OVERRIDE CONFIG (deep merge) ============ */
console.log("— Override configurazione (deep merge) —");
const merged=deepMerge(cfgLive,{stg:{dispacciamento_eur_kWh:0.02},imposte:{iva:0.22}});
ok("override vince sulla foglia",merged.stg.dispacciamento_eur_kWh===0.02&&merged.imposte.iva===0.22);
ok("rami non toccati preservati",
  merged.stg.parametroGamma_eur_pod_anno===cfgLive.stg.parametroGamma_eur_pod_anno
  &&merged.rete.quotaFissa_eur_mese===cfgLive.rete.quotaFissa_eur_mese
  &&merged.imposte.esenzioneResidente.kWhMese===150);
ok("base non mutata",cfgLive.imposte.iva===0.10&&cfgLive.stg.dispacciamento_eur_kWh===0.013);
const bOvr=CalcEngine.bolletta("stg",inp2700,null,merged,punX);
const bStd=CalcEngine.bolletta("stg",inp2700,null,cfgLive,punX);
ok("motore usa i valori mergiati",
  Math.abs((bOvr.dispacciamento-bStd.dispacciamento)-(0.02-0.013)*2700)<1e-9);

/* ============ SCADENZE ============ */
console.log("— Scadenze —");
ok("CASA FLEX scaduta all'11/07/2026",
  statoScadenza(seed["1mob-casaflex"],"2026-07-11").stato==="scaduta");
ok("offerta in scadenza (entro finestra avviso)",
  statoScadenza({scadenza:"2026-07-12"},"2026-07-11").stato==="inScadenza");

/* ============ TIER 2 — schede di confrontabilità, per offerta ============
   Ogni gruppo in golden_snapshot.json rappresenta un'offerta con la sua
   scheda di confrontabilità. offerId legge dal catalogo SEED live; offerta
   porta una definizione inline (per offerte non ancora aggiunte al catalogo). */
let errMaxGlobale=0;
for(const g of snap.gruppi){
  console.log(`— Tier 2 (${g.nome}, spesa annua esclusa imposte, tolleranza ${snap.meta.toleranzaTier2}) —`);
  const off=g.offerId?seed[g.offerId]:g.offerta;
  const cfg=g.cfgOverride
    ?{rete:g.cfgOverride.rete||cfgLive.rete,oneriSistema:g.cfgOverride.oneriSistema||cfgLive.oneriSistema,
      stg:cfgLive.stg,imposte:cfgLive.imposte}
    :cfgLive;
  let errMax=0;
  for(const p of g.punti){
    const inp={periodo:"annuale",multiorario:false,kWh:{F0:p.kWh},
      potenzaKw:p.kW,residente:p.residente};
    const b=CalcEngine.bolletta("ml",inp,off,cfg,g.punRef,new Set());
    const scontiTot=g.scontiInclusiNelTotale?(b.sconti.preIVA+b.sconti.postIVA):0;
    const esclImposte=b.materia.totale+b.dispacciamento+b.rete.totale+b.oneri.totale-scontiTot;
    const err=Math.abs(esclImposte-p.attesoEsclImposte)/p.attesoEsclImposte;
    errMax=Math.max(errMax,err);errMaxGlobale=Math.max(errMaxGlobale,err);
    ok(`  ${p.kWh} kWh ${p.kW} kW ${p.residente?"res":"nonres"} -> ${esclImposte.toFixed(2)} vs ${p.attesoEsclImposte}`,
      err<=0.01,(err*100).toFixed(3)+"%");
  }
  console.log(`  errore massimo: ${(errMax*100).toFixed(4)}%`);
}
console.log(`\nerrore massimo Tier 2 (tutti i gruppi): ${(errMaxGlobale*100).toFixed(4)}%`);
console.log(`\n${passati} test PASSATI ✔`);
