// Real Web Audio render, entirely offline: never plays through the computer's speakers.
(async()=>{
  const Native=window.AudioContext,assert=(ok,msg)=>{if(!ok)throw Error(msg);};let ctx;
  class SilentAudioContext extends OfflineAudioContext{
    constructor(){super(2,24000,48000);ctx=this;}
    get state(){return 'running';}
  }
  const a={kind:'hand',id:1,mat:'aluminium'},b={kind:'cup',id:2,mat:'ceramic'};
  const record=time=>({time,events:[{type:'impact',t:time,speed:1.5,impulse:.3,a,b,p:[0,0,0]}],touches:[{a,b,force:4,slip:.2,roll:.3,p:[0,0,0]}]});
  const energy=buffer=>buffer.getChannelData(0).reduce((s,v)=>s+v*v,0);
  try{
    window.AudioContext=SilentAudioContext;
    const old=ContactSound.create();old.set({on:true});old.play(record(12));old.reset();
    const cleared=energy(await ctx.startRendering());assert(cleared<1e-12,'restart cancels scheduled impacts and friction without an audio tail');
    const fresh=ContactSound.create();fresh.set({on:true});fresh.play(record(12));fresh.reset();fresh.play(record(0));
    const renewed=energy(await ctx.startRendering());assert(renewed>1e-5,'the first real contact in the new scene remains audible after its clock restarts');
    return {passed:true,offline:true,resetEnergy:cleared,newContactEnergy:renewed};
  }finally{window.AudioContext=Native;}
})()
