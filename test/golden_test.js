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
codice=codice.replace(/function (validaOfferta|migraV1|statoScadenza|esportaXlsx|importaXlsx|normalizzaRecordImport|importaConQuarantena|deepMerge|leggiTariffOverride|requisitiMancanti)\(/g,
  "globalThis.$1=function(");
eval(codice);

const snap=JSON.parse(fs.readFileSync(path.join(__dirname,"golden_snapshot.json"),"utf8"));
const seed=Object.fromEntries(SEED.map(o=>[o.id,o]));
let passati=0;
function ok(nome,cond,dett){ if(!cond){console.error("✗ "+nome+(dett?" — "+dett:""));process.exit(1);}
  console.log("✓ "+nome);passati++; }

/* config live (solo per test unitari non-snapshot) */
const cfgLive=JSON.parse(fs.readFileSync(path.join(__dirname,"..","config_tariffe.json"),"utf8"));
const ctx0={domiciliazione:false,bollettaElettronica:false,gasAttivo:false,sim1Mobile:false};
const inp2700={periodo:"annuale",multiorario:false,kWh:{F0:2700},potenzaKw:3,residente:true,ctx:ctx0};

/* ============ TIER 1 — materia esatta (±0,01) ============ */
console.log("— Tier 1 (materia, 2700 kWh/anno monorario) —");
const punX={F0:0.111};
function materia(id,pun){return CalcEngine.bolletta("ml",inp2700,seed[id],cfgLive,pun||punX).materia.totale;}
ok("ENEL MOVE 651,30",Math.abs(materia("enel-move")-651.30)<=0.01,materia("enel-move"));
ok("FIXA TIME 24 SMART 411,30",Math.abs(materia("plen-fixa24-smart")-411.30)<=0.01,materia("plen-fixa24-smart"));
ok("FIXA TIME 24 BASE 441,00",Math.abs(materia("plen-fixa24-base")-441.00)<=0.01,materia("plen-fixa24-base"));
ok("FIXA TIME 12 BASE 500,40",Math.abs(materia("plen-fixatime-12")-500.40)<=0.01,materia("plen-fixatime-12"));
ok("PLACET FISSA 928,08",Math.abs(materia("plen-placet-fissa")-928.08)<=0.01,materia("plen-placet-fissa"));
/* indicizzate: formula col PUN F0 di pun.json */
const punJson=JSON.parse(fs.readFileSync(path.join(__dirname,"..","dati","pun.json"),"utf8"));
const mesi=Object.keys(punJson.mesi).sort();
const P=punJson.mesi[mesi[mesi.length-1]].F0;
ok("CASA FLEX formula",
  Math.abs(materia("1mob-casaflex",{F0:P})-(207.6+(P+0.01991)*2700*1.10))<=0.01);
ok("TREND CASA formula",
  Math.abs(materia("plen-trend-casa",{F0:P})-(144+(P+0.02)*2700*1.10))<=0.01);
ok("FLEX CONTROL formula (senza cap)",
  Math.abs(materia("enel-flex-control",{F0:P})-(180+Math.min(P+0.02226,0.174)*2700))<=0.01);
/* test del cap: PUN fittizio 0,16 -> 0,18226 clampato a 0,174 */
const mCap=materia("enel-flex-control",{F0:0.16});
ok("FLEX CONTROL cap attivo (PUN 0,16)",Math.abs(mCap-(180+0.174*2700))<=0.01,mCap);
/* cap con prezzo netto perdite: clamp sul lordo */
const offNettoCap={...seed["plen-fixa24-base"],prezzoMax:0.105};
const mNC=CalcEngine.bolletta("ml",inp2700,offNettoCap,cfgLive,punX).materia.totale;
ok("cap su prezzo netto: min(0,10×1,10;0,105)",Math.abs(mNC-(144+0.105*2700))<=0.01,mNC);

/* ============ SCONTI e CONDIZIONI ============ */
console.log("— Sconti / condizioni —");
const iva=cfgLive.imposte.iva;
/* FIXA SMART: 5% perc_prezzo con domiciliazione, pre-IVA su solo consumo */
const bNo=CalcEngine.bolletta("ml",inp2700,seed["plen-fixa24-smart"],cfgLive,punX);
ok("sconto non attivo senza domiciliazione",bNo.sconti.preIVA===0&&bNo.sconti.ignorati.length===1
  &&bNo.sconti.ignorati[0].motivo.includes("domiciliazione"));
const ctxDom={...ctx0,domiciliazione:true};
const bSi=CalcEngine.bolletta("ml",{...inp2700,ctx:ctxDom},seed["plen-fixa24-smart"],cfgLive,punX);
const attesoSc=0.05*(0.09*2700*1.10);
ok("perc_prezzo 5% su Corrispettivo Luce (esclusa QF)",Math.abs(bSi.sconti.preIVA-attesoSc)<1e-9,bSi.sconti.preIVA);
ok("IVA sul netto pre-IVA",Math.abs((bNo.totale-bSi.totale)-attesoSc*(1+iva))<1e-9);
/* ENEL MOVE: bonus 60 su 24 mesi -> 30 €/anno POST-IVA */
const bDual=CalcEngine.bolletta("ml",{...inp2700,ctx:{...ctx0,gasAttivo:true}},seed["enel-move"],cfgLive,punX);
const bDualNo=CalcEngine.bolletta("ml",inp2700,seed["enel-move"],cfgLive,punX);
ok("bonus_unatantum 60/24 mesi = 30 €/anno post-IVA",
  Math.abs(bDual.sconti.postIVA-30)<1e-9&&Math.abs((bDualNo.totale-bDual.totale)-30)<1e-9);
/* CASA FLEX: eur_mese 11 con SIM -> 132 pre-IVA */
const bSim=CalcEngine.bolletta("ml",{...inp2700,ctx:{...ctx0,sim1Mobile:true}},seed["1mob-casaflex"],cfgLive,punX);
ok("eur_mese 11 ×12 = 132 pre-IVA con SIM",Math.abs(bSim.sconti.preIVA-132)<1e-9);
/* TREND CASA: sconto non su luce -> mai applicato, segnalato */
const bTrend=CalcEngine.bolletta("ml",{...inp2700,ctx:ctxDom},seed["plen-trend-casa"],cfgLive,punX);
ok("scontoSuLuce=false ignorato anche con condizione ok",
  bTrend.sconti.preIVA===0&&bTrend.sconti.ignorati[0].motivo.includes("altra fornitura"));
/* PLACET: domiciliazione+eBill richiede entrambe */
const bP1=CalcEngine.bolletta("ml",{...inp2700,ctx:ctxDom},seed["plen-placet-fissa"],cfgLive,punX);
const bP2=CalcEngine.bolletta("ml",{...inp2700,ctx:{...ctxDom,bollettaElettronica:true}},seed["plen-placet-fissa"],cfgLive,punX);
ok("domiciliazione+eBill: solo SEPA non basta",bP1.sconti.preIVA===0&&Math.abs(bP2.sconti.preIVA-6)<1e-9);
ok("quadraturaOk con sconti",bSi.quadraturaOk&&bDual.quadraturaOk);
/* extra[]: sconto aggiuntivo */
const offExtra={...seed["plen-fixa24-smart"],
  extra:[{scontoTipo:"eur_anno",scontoValore:10,scontoCond:"—",scontoSuLuce:true}]};
const bEx=CalcEngine.bolletta("ml",{...inp2700,ctx:ctxDom},offExtra,cfgLive,punX);
ok("extra[] sommato al flat",Math.abs(bEx.sconti.preIVA-(attesoSc+10))<1e-9);

/* ============ VALIDAZIONE / QUARANTENA ============ */
console.log("— Validazione —");
ok("seed tutte valide",SEED.every(o=>validaOfferta(o).ok));
ok("enum fuori vocabolario rifiutato",
  !validaOfferta({...seed["enel-move"],scontoCond:"xyz"}).ok);
ok("indicizzato senza indice rifiutato",
  !validaOfferta({...seed["1mob-casaflex"],indice:"—"}).ok);
ok("perc_prezzo fuori [0,1) rifiutato",
  !validaOfferta({...seed["plen-fixa24-smart"],scontoValore:1.5}).ok);
ok("scadenza malformata rifiutata",
  !validaOfferta({...seed["enel-move"],scadenza:"28/07/2026"}).ok);
ok("durataMesi 36 rifiutata",
  !validaOfferta({...seed["enel-move"],durataMesi:36}).ok);
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

/* ============ REQUISITI OBBLIGATORI + MAGGIOR TUTELA VULNERABILI ============ */
console.log("— Requisiti obbligatori / MTV —");
ok("requisito valido accettato",
  validaOfferta({...seed["plen-fixa24-smart"],requisitoObbligatorio:["domiciliazione"]}).ok);
ok("requisito fuori enum rifiutato",
  !validaOfferta({...seed["plen-fixa24-smart"],requisitoObbligatorio:["carta_credito"]}).ok);
ok("requisito non-array rifiutato",
  !validaOfferta({...seed["plen-fixa24-smart"],requisitoObbligatorio:"domiciliazione"}).ok);
const offReq={...seed["plen-fixa24-smart"],requisitoObbligatorio:["domiciliazione","dual_gas"]};
ok("requisitiMancanti: ctx vuoto -> entrambi",
  requisitiMancanti(offReq,ctx0).length===2);
ok("requisitiMancanti: ctx completo -> nessuno",
  requisitiMancanti(offReq,{domiciliazione:true,gasAttivo:true}).length===0);
ok("migrazione v1 aggiunge requisitoObbligatorio []",
  Array.isArray(migraV1({nome:"X",tipoPrezzo:"fisso",p0:0.1,quotaFissa:100,perdite:0.1}).requisitoObbligatorio));
const recReq=normalizzaRecordImport({nome:"R",tipoPrezzo:"fisso",p0:"0,1",quotaFissa:"100",
  perdite:"0.1",requisitoObbligatorio:"domiciliazione|dual_gas|xyz"});
ok("import xlsx: requisiti da pipe, invalidi scartati",
  recReq.requisitoObbligatorio.length===2&&validaOfferta(recReq).ok);
/* engine MTV: PED comprensivo perdite e dispacciamento */
const cfgMtv=deepMerge(cfgLive,{maggiorTutelaVulnerabili:{quotaFissaVendita_eur_mese:3,
  ped_eur_kWh:0.15,pedF1_eur_kWh:0.16,pedF23_eur_kWh:0.14}});
const bMtv=CalcEngine.bolletta("mtv",inp2700,null,cfgMtv,punX);
ok("MTV: materia = QF vendita + PED x kWh, disp incluso (=0)",
  Math.abs(bMtv.materia.totale-(36+0.15*2700))<1e-9&&bMtv.dispacciamento===0);
const bMtvM=CalcEngine.bolletta("mtv",{...inp2700,multiorario:true,kWh:{F1:1200,F2:800,F3:700}},null,cfgMtv,punX);
ok("MTV multiorario: F1 e F23",
  Math.abs(bMtvM.materia.energia-(0.16*1200+0.14*1500))<1e-9);

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
ok("Plenitude in scadenza (12/07)",
  statoScadenza(seed["plen-fixa24-smart"],"2026-07-11").stato==="inScadenza");

/* ============ TIER 2 — snapshot scheda confrontabilità ============ */
console.log("— Tier 2 (CASA FLEX, spesa annua esclusa imposte, snapshot ±1%) —");
const cfgSnap={rete:snap.rete,oneriSistema:snap.oneriSistema,stg:snap.stg,imposte:snap.imposte};
let errMax=0;
for(const p of snap.puntiGolden){
  const inp={periodo:"annuale",multiorario:false,kWh:{F0:p.kWh},
    potenzaKw:p.kW,residente:p.residente,ctx:ctx0};   // ctx tutto false: sconto SIM non attivo
  const b=CalcEngine.bolletta("ml",inp,seed["1mob-casaflex"],cfgSnap,snap.punRef);
  const esclImposte=b.materia.totale+b.dispacciamento+b.rete.totale+b.oneri.totale;
  const err=Math.abs(esclImposte-p.attesoEsclImposte)/p.attesoEsclImposte;
  errMax=Math.max(errMax,err);
  ok(`  ${p.kWh} kWh ${p.kW} kW ${p.residente?"res":"nonres"} -> ${esclImposte.toFixed(2)} vs ${p.attesoEsclImposte}`,
    err<=0.01,(err*100).toFixed(3)+"%");
}
console.log(`errore massimo Tier 2: ${(errMax*100).toFixed(4)}% (tolleranza 1%)`);
console.log(`\n${passati} test PASSATI ✔`);
