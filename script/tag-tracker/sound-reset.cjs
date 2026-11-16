// Lifecycle checks use a tiny Web Audio graph, with real sound dispatch and pair gating.
module.exports=function({check}){
  const Sound=require('../../tag-tracker/sound'),contexts=[];
  const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}});
  const node=()=>({connections:[],connect(to){this.connections.push(to);},disconnect(){this.connections=[];}});
  class AudioContext{
    constructor(){this.currentTime=20;this.sampleRate=48000;this.state='running';this.destination=node();this.sources=[];contexts.push(this);}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    createGain(){return {...node(),gain:param()};}
    createDynamicsCompressor(){return {...node(),...Object.fromEntries(['threshold','knee','ratio','attack','release'].map(k=>[k,param()]))};}
    createStereoPanner(){return {...node(),pan:param()};}
    createBiquadFilter(){return {...node(),frequency:param(),Q:param()};}
    source(){const s={...node(),frequency:param(),stops:[],start(t){this.started=t;},stop(t){this.stops.push(t);}};this.sources.push(s);return s;}
    createOscillator(){return this.source();}
    createBufferSource(){return this.source();}
  }
  const original=global.window;
  try{
    global.window={AudioContext};const player=Sound.create();player.reset();
    check(!contexts.length&&!player.on,'reset while sound is off never opens an audio context');
    player.set({on:true});const ctx=contexts[0],a={kind:'hand',id:1,mat:'aluminium'},b={kind:'cup',id:2,mat:'ceramic'};
    const record={time:12,events:[{type:'impact',a,b,t:12,speed:1.2,impulse:.3,p:[0,0,0]}],touches:[{a,b,force:4,slip:.2,roll:.3,p:[0,0,0]}]};
    player.play(record);const previous=ctx.sources.slice();
    check(previous.some(s=>s.loop)&&previous.some(s=>!s.loop)&&previous.every(s=>s.connections.length),'fixture plays both ringing impacts and continuous friction');
    player.reset();
    check(player.on&&contexts.length===1&&previous.every(s=>s.stops.at(-1)===ctx.currentTime&&!s.connections.length),'reset immediately stops and disconnects every impact and loop while preserving the enabled context');
    const before=ctx.sources.length;player.play({...record,time:0,events:record.events.map(e=>({...e,t:0}))});
    check(ctx.sources.length>before&&ctx.sources.slice(before).some(s=>!s.loop),'a new world clock rearms the first genuine contact instead of retaining an old pair timestamp');
    const after=ctx.sources.length;player.reset();player.reset();
    player.play({time:.1,events:[],touches:[]});
    check(ctx.sources.length===after,'repeated restarts and an empty scene never create a sound');
    player.set({on:false});player.reset();check(!player.on,'reset preserves the disabled sound preference');
  }finally{if(original===undefined)delete global.window;else global.window=original;}
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
