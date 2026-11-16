// Finite TacHammer cues using nrf-controller dashboard_wire.h v2. No ERM or servo writes.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.TaskHaptics=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const MAX_LEVEL=75;
  // Normal impulse / the fixed 240 Hz contact step gives impact force in N, independent
  // of render-frame averaging. 240 N spans measured gentle/firm/hard task collisions.
  // A fast smooth rise makes light taps clear; square-root compression retains force
  // ordering above that perceptual lift without flattening deliberate contacts at 75%.
  const IMPACT_FORCE=240,CONTACT_STEP=1/240;
  const CLICK=1,KNOCK=3,RUMBLE=6,SUSTAIN_MS=150,RELEASE_MS=100,CLICK_MS=140,RUMBLE_MS=300;
  const norm=v=>Math.hypot(...(v||[0,0,0]));
  const level=value=>Math.max(1,Math.min(MAX_LEVEL,Math.round(Number.isFinite(value)?value:MAX_LEVEL)));
  const impactLevel=(force,peak=MAX_LEVEL)=>{const f=Math.max(0,Number.isFinite(force)?force:0);return Math.max(1,Math.round(level(peak)*Math.min(1,.32*(1-Math.exp(-f/.08))+.68*Math.sqrt(Math.min(1,f/IMPACT_FORCE)))));};
  function settings(saved){
    return {version:2,enabled:saved?.enabled!==false,level:level(saved?.version===2?saved.level:MAX_LEVEL)};
  }
  function packet(level,id=1){
    const b=new Uint8Array(6),v=new DataView(b.buffer);b[0]=2;b[1]=2;b[2]=id;b[3]=Math.max(1,Math.min(MAX_LEVEL,Math.round(Number.isFinite(level)?level:1)));v.setUint16(4,0,true);return b;
  }
  function cue(W,side){
    const h=W.hands[side],rec=W.record,current=W.contactState||rec,hand=current?.hands?.[side],grip=h?.grip?.body;
    let force=(hand?.force||[0,0,0]).slice(),fallback=0,load=norm(force),dominant=load,reason='contact force',event=null,pair=null,impactForce=0;
    const involved=x=>x&&(x.side===+side||grip&&x.id===grip.id);
    const key=e=>{const x=involved(e.a)?e.b:e.a;return x&&[x.kind,x.id??x.link??x.side].join(':');};
    for(const c of [...(W.cloths||[]),...(W.cables||[])]){
      const reaction=c.reactions?.[side],vector=reaction?.force,f=vector?norm(vector):reaction?.load||0;
      // Direct cloth/cable loads are external wrist forces, so add vectors and
      // retain cancellation when a table supports the same load. A held plug's
      // cable tension is already transmitted by the rigid grip joint.
      if(vector)force=force.map((v,i)=>v+vector[i]);else fallback=Math.max(fallback,f);
      if(f>dominant){dominant=f;reason=c.radius?'cable tension':'fabric tension';}
      if(c.plug===grip&&c.tension>dominant){dominant=c.tension;reason='cable tension';if(!hand?.force)fallback=Math.max(fallback,c.tension);}
    }
    load=Math.max(norm(force),fallback);
    const slip=hand?.grip?.slipping;
    if(slip){load=Math.max(load,2);reason='grip slipping';}
    for(const e of rec?.events||[]){
      const force=Number.isFinite(e.force)?Math.max(0,e.force):Math.max(0,e.impulse||0)/CONTACT_STEP;
      if(e.type==='impact'&&(involved(e.a)||involved(e.b))&&(!event||force>impactForce)){
        impactForce=force;event='impact:'+e.t+':'+e.a?.id+':'+e.b?.id;pair=key(e);
      }
    }
    const at=grip?.insertion?.clickAt,seatEvent=at!=null&&W.time-at<.15?grip.id+':'+at:null;
    const contacts=(current?.touches||[]).filter(e=>involved(e.a)||involved(e.b)).map(key);
    const motion=Math.min(1,Math.max(0,norm(h?.body?.v)-.015)/.12+Math.max(0,norm(h?.body?.w)-.1)/1.5);
    return {load,reason,event,pair,impactForce,contacts,motion,seatEvent};
  }
  // No write queue: impacts are disposable, not delayed until a busy link becomes free.
  // CLICK/KNOCK self-end in 6/12 ms; 50 Hz rumble self-ends in 300 ms.
  // Resample its force level at 10 Hz. On release use capture's TacHammer-only STOP,
  // or preempt legacy rumble with a minimum 1% / 6 ms CLICK. Never STOP_ALL: it releases
  // the grip servo. Release uses the latest state, not a queued stimulus or a retry.
  function dispatcher(){
    const states=new Map(),voices=new Map();let epoch=null;
    return {
      reset(){states.clear();epoch=null;for(const v of voices.values())v.cancel=true;},
      hasRumble(now){for(const v of voices.values())if(Math.max(v.until,v.pendingUntil??-Infinity)>now)return true;return false;},
      tick({boards,world,arms,now,enabled,level:drive=MAX_LEVEL,active=true}){
        const running=enabled&&active&&!!world;
        if(!running)states.clear();
        else if(epoch!==world){states.clear();epoch=world;for(const v of voices.values())v.cancel=true;}
        for(const b of boards){
          const side=b.hapticSide==='off'?null:b.hapticSide==='1'?1:b.hapticSide==='-1'?-1:arms.find(a=>a.key!=null&&a.key===b.track&&a.live&&!a.idle)?.side;
          const ch=b.hapticCharacteristic;let v=voices.get(b);
          if(v&&v.ch!==ch){voices.delete(b);v=null;}
          if(b.sim||b.state!=='live'||!ch||!b.act?.tachammerReady||now-b.actT>500){states.delete(b);continue;}
          // Do not shake the capture IMU while it is measuring its stationary gyro bias.
          if(b.transport==='capture'&&!b.motion?.ready){states.delete(b);continue;}
          if(!v){v={ch,last:-Infinity,until:-Infinity,side,cancel:false};voices.set(b,v);}
          let s=states.get(b);
          if(!running||!side)states.delete(b);
          else if(!s||s.side!==side){v.cancel=true;s={side,lastClick:-Infinity,nextRumble:-Infinity,loaded:false,event:null,pairs:new Map(),baseline:0,motionBase:0};states.set(b,s);}
          const c=running&&side?cue(world,side):{load:0},wasLoaded=s?.loaded;
          let click=false,impact=false,seated=false,limit=false,skip=false;
          if(running&&side){
            const dt=Math.max(0,Math.min(1000,now-(s.at??now)));s.at=now;
            s.baseline+=(c.load-s.baseline)*(1-Math.exp(-dt/400));
            s.motionBase+=(c.motion-s.motionBase)*(1-Math.exp(-dt/(c.motion>s.motionBase?400:80)));
            if(c.load>=.12)s.loaded=true;
            if(c.load>=.08)s.releaseAt=null;
            else{s.releaseAt??=now;if(now-s.releaseAt>=RELEASE_MS)s.loaded=false;}
            const onset=s.loaded&&!wasLoaded;
            if(onset)s.contactAt=now;
            if(!s.loaded)s.contactAt=null;
            seated=!!c.seatEvent&&c.seatEvent!==s.seatEvent;impact=!!c.event&&s.event!==c.event&&now-(s.pairs.get(c.pair)??-Infinity)>RELEASE_MS;
            if(c.event&&c.event!==s.event)s.pairs.set(c.pair,now);
            for(const pair of c.contacts)s.pairs.set(pair,now);
            for(const [pair,at]of s.pairs)if(now-at>1000)s.pairs.delete(pair);
            const stop=arms.find(a=>a.side===side)?.wristStop||0;limit=!!(stop&~(s.stop||0));s.stop=stop;
            // Consume transient events before the rate/busy gates, so a dropped click cannot replay later.
            if(c.event)s.event=c.event;
            if(c.seatEvent)s.seatEvent=c.seatEvent;
            const transient=seated||impact||onset||limit;
            // One physical collision may involve both jaws and several solver features. Coalesce
            // those records, and never let a rejected transient turn into a delayed click.
            click=transient&&now-s.lastClick>=CLICK_MS;
            // A coalesced transient stays dropped; it must not trigger another rumble either.
            skip=transient&&!click;
          }
          const release=v.until>now&&(v.cancel||!running||!side||c.load<.08);
          const rumble=!click&&!release&&running&&side&&!skip&&s.loaded&&c.load>=.08&&now-s.contactAt>=SUSTAIN_MS&&now>=s.nextRumble;
          if(!click&&!release&&!rumble)continue;
          const minimum=1000/Math.min(25,Math.max(10,b.hapticRateHz||10));
          if(b.hapticError&&b.hapticRetryAfter&&now>=b.hapticRetryAfter){b.hapticError=null;b.hapticRetryAfter=null;}
          if(ch.busy||b.hapticBusy||b.hapticError||now-v.last<minimum)continue;
          v.last=now;if(click)s.lastClick=now;
          if(running&&side)s.nextRumble=now+(click?Math.max(60,minimum):100);b.hapticBusy=true;
          // Immediate force sets amplitude; adaptation removes the constant part of a load.
          // Movement onset restores feedback while carrying; steady motion habituates too.
          const change=running&&side?Math.min(1,Math.abs(c.load-s.baseline)/Math.max(.12,c.load,s.baseline)):0;
          const gain=running&&side?Math.sqrt(Math.min(1,c.load/12))*(.035+.965*Math.max(change,Math.max(0,c.motion-s.motionBase))):0;
          const contactForce=impact?c.impactForce:c.load;
          const strength=click?(limit||seated?level(drive):impactLevel(contactForce,drive)):release?1:Math.max(1,Math.round(level(drive)*gain));
          const bytes=packet(strength,click&&seated?KNOCK:click||release?CLICK:RUMBLE),stopping=release&&!click;
          const reason=click?(limit?'wrist rotation limit':seated?'connector seated':impact?'contact impact':'contact began'):stopping?'contact released':c.reason;
          v.pendingUntil=stopping?v.until:-Infinity;
          v.until=rumble?now+RUMBLE_MS:-Infinity;v.side=side||v.side;v.cancel=false;
          try{
            const write=stopping&&ch.stopHaptics?ch.stopHaptics():ch.writeValueWithResponse?ch.writeValueWithResponse(bytes):ch.writeValue(bytes);
            Promise.resolve(write).then(()=>{if(b.hapticCharacteristic!==ch)return;b.hapticLast={at:now,side:side||v.side,reason,kind:stopping?'stop':click?'click':'rumble',waveform:stopping&&ch.stopHaptics?0:bytes[2],level:stopping&&ch.stopHaptics?0:bytes[3],...(click&&!limit&&!seated?{force:contactForce}:{})};},e=>{if(b.hapticCharacteristic!==ch)return;b.hapticError=String(e.message||e);b.hapticRetryAfter=ch.transient?now+250:null;}).finally(()=>{v.pendingUntil=-Infinity;if(b.hapticCharacteristic===ch)b.hapticBusy=false;});
          }catch(e){v.pendingUntil=-Infinity;b.hapticError=String(e.message||e);b.hapticRetryAfter=ch.transient?now+250:null;b.hapticBusy=false;}
        }
        for(const b of voices.keys())if(!boards.includes(b)){voices.delete(b);states.delete(b);}
      }
    };
  }
  return {packet,cue,dispatcher,level,impactLevel,settings,MAX_LEVEL,IMPACT_FORCE};
});
