'use strict';
const fs=require('fs');const {load,render,pitchOf,stats}=require('./harness');
const ctx={}; new Function('ctx',fs.readFileSync(__dirname+'/../src/params.js','utf8')+';ctx.S=SCHEMA')(ctx);
const E=load(48000); E.send({t:'tables',tables:E.WT.makeAll()});
E.send({t:'patch',p:Object.assign({},ctx.S.INIT,{'f.type':0,'v.drift':0,'a.wt':0,'a.pos':0})});
E.send({t:'route',r:{track:true,trackDry:0,trackSens:0.6,guitarOn:true}});
const riff=E.SRCS.riff(48000,1);
// expected melody notes in order
const want=[64,67,69,67,64,62,60,62,64,67,72,71,69];
const seen=[]; let last=-2;
const n=Math.floor(riff.length/128)*128, oL=new Float32Array(128),oR=new Float32Array(128),inb=new Float32Array(128);
for(let o=0;o<n;o+=128){ inb.set(riff.subarray(o,o+128)); E.eng.port.sent=[]; E.eng.process([[inb]],[[oL,oR]]);
  for(const m of E.eng.port.sent) if(m.t==='m'&&m.tn!==last){ last=m.tn; if(m.tn>=0) seen.push(m.tn); } }
console.log('tracked:',seen.join(' '));console.log('melody :',want.join(' '));
// arpeggiator: hold C-E-G, count note-ons via voices
const E2=load(48000); E2.send({t:'tables',tables:E2.WT.makeAll()});
E2.send({t:'patch',p:Object.assign({},ctx.S.INIT,{'arp.on':1,'arp.rate':3,'arp.oct':2,'e1.r':0.01})}); E2.send({t:'bpm',v:120});
[60,64,67].forEach(x=>E2.send({t:'on',n:x,v:0.9}));
const notes=[]; const vcs=E2.eng.voices;
for(let o=0;o<48000*2;o+=128){ E2.eng.process([[]],[[oL,oR]]); for(const v of vcs) if(v.active&&v.age<=32*4&&v.gate&&!v._seen){v._seen=1;notes.push(v.note);} for(const v of vcs) if(v.age>128) v._seen=0; }
console.log('arp 2s @120bpm 1/16:', notes.length, 'notes:', notes.slice(0,14).join(' '));
