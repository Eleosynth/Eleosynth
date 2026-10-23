'use strict';
const fs=require('fs'),path=require('path');
const {load,render,pitchOf,stats,db}=require('./harness');
const ctx={}; new Function('ctx',fs.readFileSync(path.join(__dirname,'../src/params.js'),'utf8')+';ctx.S=SCHEMA')(ctx); const S=ctx.S;
const E=load(48000); const T=E.WT.makeAll(); E.send({t:'tables',tables:T});
for(let i=0;i<6;i++) E.send({t:'source',i,buf:E.SRCS.aroma(i,48000)});
let fails=0; const check=(name,ok,info)=>{console.log((ok?'PASS':'FAIL')+' '+name+' '+(info||'')); if(!ok) fails++;};
function patch(over){ E.send({t:'allOff'}); E.send({t:'patch',p:Object.assign({},S.INIT,over)}); E.send({t:'chain',w:'fx',chain:[]}); E.send({t:'chain',w:'ped',chain:[]}); E.send({t:'route',r:{testOn:false,track:false,tuner:false,synthToPedals:false}}); render(E,0.3); }
// 1 pitch of plain sine oscillator through open filter
for (const m of [33,45,57,69,81]) {
  patch({'f.type':0,'v.drift':0}); E.send({t:'on',n:m,v:0.9});
  const r=render(E,0.8); E.send({t:'off',n:m});
  const f=pitchOf(r.L,48000,0.2,0.4), want=440*Math.pow(2,(m-69)/12), c=1200*Math.log2(f/want);
  check('sine pitch midi '+m, Math.abs(c)<3, f.toFixed(2)+'Hz '+c.toFixed(2)+'ct');
}
// 2 every wavetable at several positions/warp: no NaN, sane level
for (let w=0; w<17; w++) for (const pos of [0,0.5,1]) for (const wm of [0,1,4,5,6]) {
  patch({'a.wt':w,'a.pos':pos,'a.warpMode':wm,'a.warp':0.6,'a.uni':4,'b.on':1,'b.wt':(w+3)%17}); E.send({t:'on',n:48,v:1}); E.send({t:'on',n:72,v:1});
  const r=render(E,0.25); const s=stats(r.L);
  if (s.nan||s.pk<0.01||s.pk>1.01) check('table '+w+' pos '+pos+' warp '+wm,false,JSON.stringify(s));
}
console.log('tables sweep done');
// 3 filters + all sources incl. tine, aroma, noise, sub
for (let ft=0; ft<8; ft++) {
  patch({'f.type':ft,'f.cutoff':0.5,'f.res':0.8,'f.drive':0.5,'sub.on':1,'n.on':1,'r.on':1,'g.on':1,'a.uni':7,'f.env':0.5});
  for (const n of [36,48,60,64,67,84]) E.send({t:'on',n,v:0.8});
  const r=render(E,0.6); const s=stats(r.L); check('filter '+S.FILT[ft], !s.nan && s.pk>0.01 && s.pk<1.01, 'pk '+db(s.pk)+'dB rms '+db(s.rms));
}
// 4 electric piano: each model, pitch + decay
for (let m=0;m<6;m++){
  patch({'a.on':0,'r.on':1,'r.model':m,'f.type':0,'e1.s':1,'e1.r':0.3,'v.drift':0}); E.send({t:'on',n:57,v:0.8});
  const r=render(E,1.6); const s1=stats(r.L.subarray(4800,24000)), s2=stats(r.L.subarray(60000,76800));
  const f=pitchOf(r.L,48000,0.3,0.4);
  check('tine '+S.EP[m], !s1.nan && s1.pk>0.05 && s1.pk<1.01 && s2.rms<s1.rms, 'pitch '+f.toFixed(1)+' (220) early '+db(s1.rms)+' late '+db(s2.rms));
}
// 5 guitar riff through each FX unit (as pedal) and as synth fx
const riff=E.SRCS.riff(48000,0);
for (const type of Object.keys(S.FX)) {
  patch({});
  E.send({t:'chain',w:'ped',chain:[{id:1,type,on:true,p:S.fxDefaults(type)}]});
  if (type==='looper') E.send({t:'loop',w:'ped',i:0,c:'tap'});
  E.send({t:'route',r:{testOn:false,gtrLevel:1}});
  const t0=Date.now(); const r=render(E,2,riff); const ms=Date.now()-t0;
  const s=stats(r.L), sr=stats(r.R);
  check('pedal '+type.padEnd(10), !s.nan && !sr.nan && s.pk>0.005 && s.pk<1.01, 'pk '+db(s.pk)+' rms '+db(s.rms)+' R '+db(sr.rms)+'  '+(ms/2*100/1000).toFixed(1)+'% cpu');
}
// 6 CPU: heavy patch 8 voices, 2 osc x 7 unison, tine, aroma, ladder, fx
patch({'a.uni':7,'b.on':1,'b.uni':7,'r.on':1,'g.on':1,'sub.on':1,'n.on':1,'f.type':1});
E.send({t:'chain',w:'fx',chain:['chorus','delay','reverb'].map((type,i)=>({id:i,type,on:true,p:S.fxDefaults(type)}))});
for (const n of [48,52,55,59,62,64,67,71]) E.send({t:'on',n,v:0.8});
let t0=Date.now(); render(E,3); console.log('heavy patch: '+((Date.now()-t0)/3/10).toFixed(1)+'% of one core');
patch({}); for (const n of [48,52,55,59,62,64,67,71]) E.send({t:'on',n,v:0.8});
t0=Date.now(); render(E,3); console.log('init patch 8 voices: '+((Date.now()-t0)/3/10).toFixed(1)+'%');
console.log(fails?fails+' FAILURES':'ALL PASS');
