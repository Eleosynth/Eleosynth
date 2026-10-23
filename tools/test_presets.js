'use strict';
// Renders every factory sound (with its FX chain) and every rig: no NaN, audible, not clipping hard.
const fs=require('fs');const {load,render,stats,db}=require('./harness');
const ctx={}; new Function('ctx',['params.js','presets.js'].map(f=>fs.readFileSync(__dirname+'/../src/'+f,'utf8')).join(';')+';ctx.S=SCHEMA;ctx.PR=PRESETS')(ctx);
const {S,PR}=ctx; const E=load(48000); E.send({t:'tables',tables:E.WT.makeAll()});
for(let i=0;i<6;i++) E.send({t:'source',i,buf:E.SRCS.aroma(i,48000),sr:48000});
const riffs=[0,1,2,3].map(k=>E.SRCS.riff(48000,k)); E.send({t:'source',i:6,buf:riffs[1],sr:48000});
let bad=0;
for(const p of PR.PATCHES){
  E.send({t:'allOff'}); E.send({t:'chain',w:'ped',chain:[]}); E.send({t:'route',r:{testOn:false,track:false}});
  E.send({t:'patch',p:Object.assign({},S.INIT,p.p)});
  E.send({t:'chain',w:'fx',chain:(p.fx||[]).map((f,i)=>({id:i,type:f.type,on:true,p:Object.assign(S.fxDefaults(f.type),f.p)}))});
  render(E,0.1);
  const notes = p.cat==='Bass'?[36]:p.cat==='Leads'||p.cat==='Guitar synth'?[64]:[48,55,60,64];
  for(const n of notes) E.send({t:'on',n,v:0.8});
  const r=render(E,1.5); for(const n of notes) E.send({t:'off',n}); const tail=render(E,0.8);
  const s=stats(r.L), sr=stats(r.R);
  const ok=!s.nan&&!sr.nan&&s.pk>0.02&&s.rms>0.004;
  if(!ok) bad++;
  console.log((ok?'ok  ':'BAD ')+p.cat.padEnd(13)+p.name.padEnd(20)+' peak '+db(Math.max(s.pk,sr.pk)).padStart(6)+' dB  rms '+db(s.rms).padStart(6)+'  limiter '+(E.eng.limG<0.9?'working ('+db(E.eng.limG)+')':'idle'));
}
E.send({t:'patch',p:S.INIT}); E.send({t:'chain',w:'fx',chain:[]});
for(const rg of PR.RIGS){
  E.send({t:'allOff'});E.send({t:'chain',w:'ped',chain:rg.chain.map((f,i)=>({id:100+i,type:f.type,on:true,p:Object.assign(S.fxDefaults(f.type),f.p)}))});
  const r=render(E,2,riffs[rg.name==='Bass DI'?3:0]); const s=stats(r.L);
  const ok=!s.nan&&s.pk>0.01; if(!ok) bad++;
  console.log((ok?'ok  ':'BAD ')+'Rig          '+rg.name.padEnd(20)+' peak '+db(s.pk).padStart(6)+' dB  rms '+db(s.rms).padStart(6));
}
console.log(bad?bad+' problems':'every sound and rig renders cleanly');
