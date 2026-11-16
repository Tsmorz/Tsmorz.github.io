// Finite TacHammer cues using nrf-controller dashboard_wire.h v2. No ERM or servo writes.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.TaskHaptics=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const MAX_LEVEL=75;
  const CLICK=1,KNOCK=3,RUMBLE=6,SUSTAIN_MS=150,RELEASE_MS=100,CLICK_MS=140;
  const norm=v=>Math.hypot(...(v||[0,0,0]));
  const level=value=>Math.max(1,Math.min(MAX_LEVEL,Math.round(Number.isFinite(value)?value:MAX_LEVEL)));
  function settings(saved){
    return {version:2,enabled:saved?.enabled!==false,level:level(saved?.version===2?saved.level:MAX_LEVEL)};
  }
  function packet(level,id=1){
    const b=new Uint8Array(6),v=new DataView(b.buffer);b[0]=2;b[1]=2;b[2]=id;b[3]=Math.max(1,Math.min(MAX_LEVEL,Math.round(Number.isFinite(level)?level:1)));v.setUint16(4,0,true);return b;
  }
  function cue(W,side){
    const h=W.hands[side],rec=W.record,hand=rec?.hands?.[side],grip=h?.grip?.body;
    let load=norm(hand?.force),reason='contact force',event=null,pair=null,impulse=-Infinity;
    const involved=x=>x&&(x.side===+side||grip&&x.id===grip.id);
    const key=e=>{const x=involved(e.a)?e.b:e.a;return x&&[x.kind,x.id??x.link??x.side].join(':');};
    for(const c of [...(W.cloths||[]),...(W.cables||[])]){
      const f=c.reactions?.[side]?.load||0;if(f>load){load=f;reason=c.radius?'cable tension':'fabric tension';}
      if(c.plug===grip&&c.tension>load){load=c.tension;reason='cable tension';}
    }
    const slip=hand?.grip?.slipping;
    if(slip){load=Math.max(load,2);reason='grip slipping';}
    for(const e of rec?.events||[]){
      if(e.type==='impact'&&(involved(e.a)||involved(e.b))&&(e.impulse||0)>impulse){
        impulse=e.impulse||0;event='impact:'+e.t+':'+e.a?.id+':'+e.b?.id;pair=key(e);
      }
    }
    const at=grip?.insertion?.clickAt,seatEvent=at!=null&&W.time-at<.15?grip.id+':'+at:null;
    const contacts=(rec?.touches||[]).filter(e=>involved(e.a)||involved(e.b)).map(key);
    const motion=Math.min(1,Math.max(0,norm(h?.body?.v)-.015)/.12+Math.max(0,norm(h?.body?.w)-.1)/1.5);
    return {load,reason,event,pair,contacts,motion,seatEvent};
  }
  // No write queue: impacts are disposable, not delayed until a busy link becomes free.
  // CLICK/KNOCK self-end in 6/12 ms; 50 Hz rumble self-ends in 300 ms.
  // Resample its force level at 10 Hz; the newest finite pulse replaces the old one.
  // Never STOP_ALL on release/off: that would also release the grip servo.
  function dispatcher(){
    const states=new Map();let epoch=null;
    return {
      reset(){states.clear();epoch=null;},
      tick({boards,world,arms,now,enabled,level:drive=MAX_LEVEL,active=true}){
        if(!enabled||!active||!world){states.clear();return;}
        if(epoch!==world){states.clear();epoch=world;}
        for(const b of boards){
          const side=b.hapticSide==='off'?null:b.hapticSide==='1'?1:b.hapticSide==='-1'?-1:arms.find(a=>a.key!=null&&a.key===b.track&&a.live&&!a.idle)?.side;
          if(!side||b.sim||b.state!=='live'||!b.hapticCharacteristic||!b.act?.tachammerReady||now-b.actT>500){states.delete(b);continue;}
          // Do not shake the capture IMU while it is measuring its stationary gyro bias.
          if(b.transport==='capture'&&!b.motion?.ready){states.delete(b);continue;}
          let s=states.get(b);if(!s||s.side!==side){s={side,last:-Infinity,lastClick:-Infinity,nextRumble:-Infinity,loaded:false,event:null,pairs:new Map(),baseline:0,motionBase:0};states.set(b,s);}
          const c=cue(world,side),wasLoaded=s.loaded;
          const dt=Math.max(0,Math.min(1000,now-(s.at??now)));s.at=now;
          s.baseline+=(c.load-s.baseline)*(1-Math.exp(-dt/400));
          s.motionBase+=(c.motion-s.motionBase)*(1-Math.exp(-dt/(c.motion>s.motionBase?400:80)));
          if(c.load>=.12)s.loaded=true;
          if(c.load>=.08)s.releaseAt=null;
          else{s.releaseAt??=now;if(now-s.releaseAt>=RELEASE_MS)s.loaded=false;}
          const onset=s.loaded&&!wasLoaded;
          if(onset)s.contactAt=now;
          if(!s.loaded)s.contactAt=null;
          const seated=!!c.seatEvent&&c.seatEvent!==s.seatEvent,impact=!!c.event&&s.event!==c.event&&now-(s.pairs.get(c.pair)??-Infinity)>RELEASE_MS;
          if(c.event&&c.event!==s.event)s.pairs.set(c.pair,now);
          for(const pair of c.contacts)s.pairs.set(pair,now);
          for(const [pair,at]of s.pairs)if(now-at>1000)s.pairs.delete(pair);
          const stop=arms.find(a=>a.side===side)?.wristStop||0,limit=!!(stop&~(s.stop||0));s.stop=stop;
          // Consume transient events before the rate/busy gates, so a dropped click cannot replay later.
          if(c.event)s.event=c.event;
          if(c.seatEvent)s.seatEvent=c.seatEvent;
          const transient=seated||impact||onset||limit;
          // One physical collision may involve both jaws and several solver features. Coalesce
          // those records, and never let a rejected transient turn into a delayed click.
          const click=transient&&now-s.lastClick>=CLICK_MS;
          if(transient&&!click)continue;
          if(!click&&(!s.loaded||c.load<.08||now-s.contactAt<SUSTAIN_MS||now<s.nextRumble))continue;
          const minimum=1000/Math.min(25,Math.max(10,b.hapticRateHz||10));
          if(b.hapticError&&b.hapticRetryAfter&&now>=b.hapticRetryAfter){b.hapticError=null;b.hapticRetryAfter=null;}
          if(b.hapticCharacteristic.busy||b.hapticBusy||b.hapticError||now-s.last<minimum)continue;
          s.last=now;if(click)s.lastClick=now;
          s.nextRumble=now+(click?Math.max(60,minimum):100);b.hapticBusy=true;
          // Immediate force sets amplitude; adaptation removes the constant part of a load.
          // Movement onset restores feedback while carrying; steady motion habituates too.
          const change=Math.min(1,Math.abs(c.load-s.baseline)/Math.max(.12,c.load,s.baseline));
          const gain=Math.min(1,c.load/12)*(.035+.965*Math.max(change,Math.max(0,c.motion-s.motionBase)));
          const bytes=packet(click?level(drive):Math.max(1,Math.round(level(drive)*gain)),click?(seated?KNOCK:CLICK):RUMBLE),ch=b.hapticCharacteristic;
          const reason=click?(limit?'wrist rotation limit':seated?'connector seated':impact?'contact impact':'contact began'):c.reason;
          try{
            const write=ch.writeValueWithResponse?ch.writeValueWithResponse(bytes):ch.writeValue(bytes);
            Promise.resolve(write).then(()=>{if(b.hapticCharacteristic!==ch)return;b.hapticLast={at:now,side,reason,kind:click?'click':'rumble',waveform:bytes[2],level:bytes[3]};},e=>{if(b.hapticCharacteristic!==ch)return;b.hapticError=String(e.message||e);b.hapticRetryAfter=ch.transient?now+250:null;}).finally(()=>{if(b.hapticCharacteristic===ch)b.hapticBusy=false;});
          }catch(e){b.hapticError=String(e.message||e);b.hapticRetryAfter=ch.transient?now+250:null;b.hapticBusy=false;}
        }
      }
    };
  }
  return {packet,cue,dispatcher,level,settings,MAX_LEVEL};
});
