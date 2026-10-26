'use strict';
// Tests for the 0.2 features: drone types, drone lock, touch pad voices, looper undo/feedback, master section.
const fs=require('fs');const {load,render,stats,db,pitchOf}=require('./harness');
const ctx={}; new Function('ctx',fs.readFileSync(__dirname+'/../src/params.js','utf8')+';ctx.S=SCHEMA')(ctx); const S=ctx.S;
let bad=0; const ok=(name,c,info)=>{console.log((c?'PASS ':'FAIL ')+name+(info?'  '+info:'')); if(!c) bad++;};
const E=load(48000); E.send({t:'tables',tables:E.WT.makeAll()});
const init=(o)=>{E.send({t:'allOff'}); E.send({t:'patch',p:Object.assign({},S.INIT,o||{})}); E.send({t:'chain',w:'fx',chain:[]}); E.send({t:'chain',w:'ped',chain:[]}); E.send({t:'drone',p:{on:0}}); E.send({t:'master',p:{}}); render(E,2.5);};
// drones
for (const [t,name] of [[0,'Tanpura'],[1,'Shruti box'],[2,'Uilleann'],[3,'Analog'],[4,'Glass']]) {
  init(); E.send({t:'drone',p:{on:1,type:t,root:48,level:0.7,tone:0.6,fifth:0.7,move:0.4,cycle:4,jawari:0.6,first:0}});
  const t0=Date.now(); const r=render(E,4); const ms=Date.now()-t0; const s=stats(r.L.subarray(48000*2));
  ok('drone '+name, !s.nan && s.rms>0.005 && s.pk<1.01, 'rms '+db(s.rms)+' dB, cpu '+(ms/4/10).toFixed(1)+'%');
}
E.send({t:'drone',p:{on:0,type:0}}); render(E,3); ok('drone fades out', stats(render(E,0.5).L).pk<0.01);
// drone lock: hold C-E-G, lock, release keys -> still sounding; unlock -> silent
init({'e1.r':0.05});
[60,64,67].forEach(n=>E.send({t:'on',n,v:0.8})); render(E,0.3); E.send({t:'lock',v:true}); [60,64,67].forEach(n=>E.send({t:'off',n}));
let a=stats(render(E,1).L).rms; ok('lock holds a chord after release', a>0.01, db(a)+' dB');
E.send({t:'on',n:72,v:0.8}); render(E,0.2); E.send({t:'off',n:72}); render(E,0.4);
ok('notes over the lock play and release', E.eng.voices.filter(v=>v.active&&v.gate).length===3, E.eng.voices.filter(v=>v.active&&v.gate).map(v=>v.note).join(','));
E.send({t:'lock',v:false}); render(E,0.5); ok('unlock releases', stats(render(E,0.3).L).rms<0.002);
// armed lock: press lock first, then play
E.send({t:'lock',v:true}); E.send({t:'on',n:57,v:0.8}); render(E,0.2); E.send({t:'off',n:57}); render(E,0.6);
ok('armed lock catches the next note', E.eng.voices.some(v=>v.active&&v.gate&&v.note===57)); E.send({t:'lock',v:false});
// touch pad: glide from 60 to 64.5, pitch follows; Y filter
init({'f.type':0,'v.drift':0,'a.pos':0});
E.send({t:'padOn',id:0,m:60,v:0.8}); render(E,0.3); E.send({t:'padMove',id:0,m:64.5}); const rp=render(E,0.6);
const f=pitchOf(rp.L,48000,0.2,0.3), want=440*Math.pow(2,(64.5-69)/12);
ok('pad slides to fractional pitch', Math.abs(1200*Math.log2(f/want))<5, f.toFixed(2)+' Hz vs '+want.toFixed(2));
E.send({t:'padOff',id:0}); render(E,1.2); ok('pad release', !E.eng.voices[12].gate);
// looper undo + feedback
init();
const loop=[{id:1,type:'looper',on:true,p:{level:1,feedback:1}}]; E.send({t:'chain',w:'ped',chain:loop});
const tone=new Float32Array(48000).map((_,i)=>0.2*Math.sin(2*Math.PI*220*i/48000));
E.send({t:'loop',w:'ped',i:0,c:'tap'}); render(E,1,tone); E.send({t:'loop',w:'ped',i:0,c:'tap'});
const base=stats(render(E,1).L).rms;
E.send({t:'loop',w:'ped',i:0,c:'tap'}); render(E,1,tone); E.send({t:'loop',w:'ped',i:0,c:'tap'}); // overdub one pass
const two=stats(render(E,1).L).rms; E.send({t:'loop',w:'ped',i:0,c:'undo'}); const back=stats(render(E,1).L).rms;
ok('looper layer adds and undo removes it', two>base*1.5 && Math.abs(back-base)/base<0.1, `1 layer ${db(base)} / 2 layers ${db(two)} / after undo ${db(back)}`);
// master: compressor reduces level, width 0 -> mono, ceiling caps peaks
init({'a.uni':5,'a.pos':0.666}); [48,55,60,64].forEach(n=>E.send({t:'on',n,v:1}));
const dry=stats(render(E,1).L).rms; E.send({t:'master',p:{comp:1,ratio:4}}); render(E,0.3); const comp=E.eng.master.gr;
E.send({t:'master',p:{width:0}}); const mono=render(E,0.5); let diff=0; for(let i=0;i<mono.L.length;i++) diff=Math.max(diff,Math.abs(mono.L[i]-mono.R[i]));
E.send({t:'master',p:{ceiling:-12}}); const capped=stats(render(E,1).L.subarray(24000)).pk;
ok('glue compressor engages', comp>2, comp.toFixed(1)+' dB reduction');
ok('width 0 is mono', diff<1e-3, 'max L-R '+diff.toExponential(1));
ok('ceiling caps output', capped<=0.26, 'peak '+db(capped)+' dB (ceiling -12)');
console.log(bad?bad+' FAILURES':'ALL PASS');
