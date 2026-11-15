// Finite TacHammer cues using nrf-controller dashboard_wire.h v2. No ERM or servo writes.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.TaskHaptics=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const MAX_LEVEL=75;
  const CLICK=1,KNOCK=3,RUMBLE=6,RUMBLE_MS=300,SUSTAIN_MS=150;
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
    let load=norm(hand?.force),reason='contact force',event=null,impulse=-Infinity;
    for(const c of [...(W.cloths||[]),...(W.cables||[])]){
      const f=c.reactions?.[side]?.load||0;if(f>load){load=f;reason=c.radius?'cable tension':'fabric tension';}
      if(c.plug===grip&&c.tension>load){load=c.tension;reason='cable tension';}
    }
    const slip=hand?.grip?.slipping;
    if(slip){load=Math.max(load,2);reason='grip slipping';}
    for(const e of rec?.events||[]){
      const involved=x=>x&&(x.side===+side||grip&&x.id===grip.id);
      if(e.type==='impact'&&(involved(e.a)||involved(e.b))&&(e.impulse||0)>impulse){
        impulse=e.impulse||0;event='impact:'+e.t+':'+e.a?.id+':'+e.b?.id;
      }
    }
    const at=grip?.insertion?.clickAt,seatEvent=at!=null&&W.time-at<.15?grip.id+':'+at:null;
    return {load,reason,event,seatEvent};
  }
  // No write queue: impacts are disposable, not delayed until a busy link becomes free.
  // CLICK/KNOCK self-end in 6/12 ms; 50 Hz rumble self-ends in 300 ms and renews only under load.
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
          let s=states.get(b);if(!s||s.side!==side){s={side,last:-Infinity,nextRumble:-Infinity,loaded:false,event:null};states.set(b,s);}
          const c=cue(world,side),wasLoaded=s.loaded;
          s.loaded=c.load>=(wasLoaded ? .08 : .12);
          const onset=s.loaded&&!wasLoaded;
          if(onset)s.contactAt=now;
          if(!s.loaded)s.contactAt=null;
          const seated=!!c.seatEvent&&c.seatEvent!==s.seatEvent,impact=!!c.event&&s.event!==c.event;
          // Consume transient events before the rate/busy gates, so a dropped click cannot replay later.
          if(c.event)s.event=c.event;
          if(c.seatEvent)s.seatEvent=c.seatEvent;
          const click=seated||impact||onset;
          if(!click&&(!s.loaded||now-s.contactAt<SUSTAIN_MS||now<s.nextRumble))continue;
          const minimum=1000/Math.min(25,Math.max(10,b.hapticRateHz||10));
          if(b.hapticError&&b.hapticRetryAfter&&now>=b.hapticRetryAfter){b.hapticError=null;b.hapticRetryAfter=null;}
          if(b.hapticCharacteristic.busy||b.hapticBusy||b.hapticError||now-s.last<minimum)continue;
          s.last=now;s.nextRumble=now+(click?Math.max(60,minimum):RUMBLE_MS);b.hapticBusy=true;
          const bytes=packet(level(drive),click?(seated?KNOCK:CLICK):RUMBLE),ch=b.hapticCharacteristic;
          const reason=click?(seated?'connector seated':impact?'contact impact':'contact began'):c.reason;
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
