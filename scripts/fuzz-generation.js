const Module=require("module");const path=require("path");const orig=Module._resolveFilename;
Module._resolveFilename=function(r,...a){ if(r.startsWith("@/")) r=path.join(__dirname,"out",r.slice(2)); return orig.call(this,r,...a);};
const E=require("./out/lib/maison-engine.js");const T=require("./out/lib/maison-types.js");const C=require("./out/lib/electrical-constants.js");
const TYPES=["prise","prise_commandee","point_lumineux","applique","spot","spot_etanche","interrupteur","va_et_vient","telerupteur","interrupteur_double","va_et_vient_double","telerupteur_double","four","plaque","lave_linge","lave_vaisselle","seche_linge","chauffe_eau","chauffage","clim","seche_serviette","congelateur","irve","piscine","vmc","alarme","volet_roulant","inter_volet","inter_vmc","rj45","prise_tv","prise_dediee","prise_exterieure","prise_irve","applique_exterieure","point_lumineux_exterieur","interrupteur_exterieur","detecteur_mouvement","detecteur_mouvement_exterieur"];
const PIECES=["sejour","chambre","cuisine","sdb","wc","circulation","exterieur","garage","autre"];
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
const cnt={};let fails=0,total=0,devs=0,autoFix=0;
for(let seed=1;seed<=600;seed++){
  const R=rng(seed);const pick=a=>a[Math.floor(R()*a.length)];
  let id=1;const niveaux=[];const nN=1+Math.floor(R()*3);const allIds=[];
  for(let n=0;n<nN;n++){
    const pieces=[];const nP=1+Math.floor(R()*4);
    for(let p=0;p<nP;p++){
      const ox=p*12;const aps=[];const nA=Math.floor(R()*14);
      for(let k=0;k<nA;k++){const t=pick(TYPES);const a={id:id++,type:t,x:ox+R()*10,y:R()*8};
        if(t==="prise_dediee"&&R()<.7)a.usageDedie=pick(["four","lave_linge","prise","point_lumineux",undefined,"chauffe_eau"]);
        if(R()<.05)a.dejaExistant=true;aps.push(a);allIds.push(a.id);}
      pieces.push({id:100*n+p+1,nom:"P"+n+p,type:pick(PIECES),contour:[{x:ox,y:0},{x:ox+10,y:0},{x:ox+10,y:8},{x:ox,y:8}],appareillages:aps});
    }
    niveaux.push({id:n+1,nom:"N"+n,type:n===0?"rdc":"etage",ordre:n,tableauPos:R()<.8?{x:1,y:1}:undefined,pointArriveeGaines:R()<.5?{x:2,y:2}:undefined,pieces,circuitsManuels:[],appareillagesExclus:[]});
  }
  // liens aléatoires
  const manIds=[];
  niveaux.forEach(n=>{ if(R()<.5){const m={id:9000+n.id*10,nom:"Man"+n.id,famille:pick(["prise_16","lumiere","four","chauffage","exterieur","volets_roulants","autre"]),nonRelieTableau:R()<.2};n.circuitsManuels.push(m);manIds.push(m.id);} });
  niveaux.forEach(n=>n.pieces.forEach(p=>p.appareillages.forEach(a=>{
    if(T.estCommande(a.type)||a.type.includes("detecteur")){ if(R()<.8) a.commandePourIds=[pick([...allIds,99999,-1])]; if(R()<.2) a.commandePourIds2=[pick(allIds)]; }
    if(manIds.length&&R()<.15) a.circuitManuelId=pick([...manIds,424242]);
    if(R()<.1) n.appareillagesExclus.push(a.id);
    if(R()<.05) a.domotique=true;
  })));
  total++;
  try{
    const r=E.genererCircuits({niveaux});
    const bids=new Set(r.breakers.map(b=>b.id));if(bids.size!==r.breakers.length)throw new Error("ids de breakers dupliqués");
    r.maison.niveaux.forEach(n=>n.pieces.forEach(p=>p.appareillages.forEach(a=>{devs++;
      if(a.circuitId==null||!bids.has(a.circuitId))throw new Error(`appareil ${a.id} (${a.type}) sans circuit valide`);})));
    // limites NF des circuits auto
    r.breakers.filter(b=>b.manuelId==null&&b.circuit==="lumiere").forEach(b=>{const n=r.maison.niveaux.flatMap(n=>n.pieces.flatMap(p=>p.appareillages)).filter(a=>a.circuitId===b.id&&T.estLumiere(a.type)).length;if(n>8)throw new Error("lumière >8: "+n);});
    r.breakers.filter(b=>b.manuelId==null&&["prise_16","prise_20","exterieur","cuisine_prises"].includes(b.circuit)).forEach(b=>{const n=r.maison.niveaux.flatMap(n=>n.pieces.flatMap(p=>p.appareillages)).filter(a=>a.circuitId===b.id).length;const max=C.MAX_PAR_CIRCUIT[b.circuit]??8;if(n>max)throw new Error(`${b.circuit} ${n}>${max}`);});
    const tousAp=r.maison.niveaux.flatMap(n=>n.pieces.flatMap(p=>p.appareillages.map(a=>({a,n}))));
    r.breakers.forEach(b=>{const m=tousAp.filter(x=>x.a.circuitId===b.id);
      if(m.length===0&&b.manuelId==null)throw new Error("circuit auto vide: "+b.label);
      if(b.manuelId==null&&C.CIRCUITS[b.circuit]?.dedié){const nb=m.filter(x=>!T.estCommande(x.a.type)&&!T.estCommandeService(x.a.type)).length;if(nb>1)throw new Error("dédié >1 appareil: "+b.label);}
      if(b.manuelId==null&&b.circuit!=="lumiere"){const nv=new Set(m.map(x=>x.n.id));if(nv.size>1)throw new Error("circuit auto multi-niveaux: "+b.label);}
      if(b.niveauId==null)throw new Error("niveauId manquant: "+b.label);});
    // tracé de tous les circuits sans exception
    r.maison.niveaux.forEach(n=>{const o=T.origineCircuits(n);if(!o)return;E.breakersDuNiveau(r.breakers,n).forEach(b=>{const pts=n.pieces.flatMap(p=>p.appareillages).filter(a=>a.circuitId===b.id);E.segmentsPourCircuit(b,pts,n,o);});});
    r.alertes.filter(a=>/rattaché|créé|relié à la lampe/.test(a)).forEach(a=>{const k=a.replace(/^.*?: /,"").replace(/«[^»]*»/g,"«»").replace(/\(.*?\)/g,"").slice(0,70);cnt[k]=(cnt[k]||0)+1;autoFix++;});
    // idempotence : 2e génération sur le résultat → même nombre de circuits
    const r2=E.genererCircuits(r.maison);
    if(r2.breakers.length!==r.breakers.length)throw new Error(`non idempotent ${r.breakers.length} vs ${r2.breakers.length}`);
  }catch(e){fails++;if(fails<=8)console.log("seed",seed,"→",e.message.split("\n")[0]);}
}
console.log(`${total} plans, ${devs} appareils, ${fails} échecs, ${autoFix} rattachements de secours`);
console.log(Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,12));
// ManuelsSeuls : seuls des circuits manuels, aucun appareil non manuel raccordé
{let bad=0;for(let seed=1000;seed<1200;seed++){const R=rng(seed);let id=1;
 const ap=[...Array(10).keys()].map(i=>({id:id++,type:["prise","point_lumineux","four"][i%3],x:R()*10,y:R()*8}));
 ap[0].circuitManuelId=7;ap[1].circuitManuelId=7;
 const n={id:1,nom:"N",type:"rdc",ordre:0,tableauPos:{x:1,y:1},pieces:[{id:1,nom:"P",type:"sejour",contour:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}],appareillages:ap}],circuitsManuels:[{id:7,nom:"M",famille:"prise_16"}]};
 const r=E.genererCircuitsManuelsSeuls({niveaux:[n]},null);
 if(r.breakers.length!==1||r.maison.niveaux[0].pieces[0].appareillages.filter(a=>a.circuitId!=null).length!==2)bad++;}
 console.log("ManuelsSeuls incorrects:",bad);}
