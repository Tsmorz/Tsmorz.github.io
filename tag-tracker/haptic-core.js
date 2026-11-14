// Finite TacHammer cues using nrf-controller dashboard_wire.h v2. No ERM or servo writes.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.TaskHaptics=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const norm=v=>Math.hypot(...(v||[0,0,0]));
  function packet(level,id=1){
    const b=new Uint8Array(6),v=new DataView(b.buffer);b[0]=2;b[1]=2;b[2]=id;b[3]=Math.max(1,Math.min(45,Math.round(Number.isFinite(level)?level:1)));v.setUint16(4,0,true);return b;
  }
  function cue(W,side){
    const h=W.hands[side],rec=W.record,hand=rec?.hands?.[side],grip=h?.grip?.body;
    let load=norm(hand?.force),reason='contact',event=null;
    for(const c of [...(W.cloths||[]),...(W.cables||[])]){
      const f=c.reactions?.[side]?.load||0;if(f>load){load=f;reason=c.radius?'cable tension':'fabric tension';}
      if(c.plug===grip&&c.tension>load){load=c.tension;reason='cable tension';}
    }
    const slip=hand?.grip?.slipping;
    if(slip){load=Math.max(load,2);reason='grip slipping';}
    for(const e of rec?.events||[]){
      const involved=x=>x&&(x.side===+side||grip&&x.id===grip.id);
      if(involved(e.a)||involved(e.b)){load=Math.max(load,(e.impulse||0)*150);event='impact:'+e.t;reason='contact impact';}
    }
    const at=grip?.insertion?.clickAt,seatEvent=at!=null&&W.time-at<.15?grip.id+':'+at:null;
    return {load,reason,event,seatEvent};
  }
  // No write queue: a busy characteristic drops the next cue. Commands are click (6 ms) or knock (12 ms)
  // and self-terminate in firmware. Turning off never uses STOP_ALL, which would also release the grip servo.
  function dispatcher(){
    const states=new Map();let epoch=null;
    return {
      reset(){states.clear();epoch=null;},
      tick({boards,world,arms,now,enabled,strength=.6,active=true}){
        if(!enabled||!active||!world){states.clear();return;}
        if(epoch!==world){states.clear();epoch=world;}
        for(const b of boards){
          const side=b.hapticSide==='off'?null:b.hapticSide==='1'?1:b.hapticSide==='-1'?-1:arms.find(a=>a.key!=null&&a.key===b.track&&a.live&&!a.idle)?.side;
          if(!side||b.sim||b.state!=='live'||!b.hapticCharacteristic||!b.act?.tachammerReady||now-b.actT>500)continue;
          let s=states.get(b);if(!s){s={last:-Infinity,busy:false,event:null,seated:false};states.set(b,s);}
          const c=cue(world,side);if(c.seatEvent&&c.seatEvent!==s.seatEvent){s.seatAt=now;s.seatEvent=c.seatEvent;}
          const click=s.seatAt!=null&&now-s.seatAt<150,impact=c.event&&s.event!==c.event;
          if(c.load<.12&&!click&&!impact)continue;
          const minimum=1000/Math.min(25,Math.max(10,b.hapticRateHz||10));
          const changed=s.load!=null&&Math.abs(c.load-s.load)>Math.max(.3,s.load*.2);
          const interval=click||impact||changed?minimum:Math.max(minimum,420-100*Math.log1p(c.load));
          if(b.hapticError&&b.hapticRetryAfter&&now>=b.hapticRetryAfter){b.hapticError=null;b.hapticRetryAfter=null;}
          if(b.hapticCharacteristic.busy||b.hapticBusy||b.hapticError||now-s.last<interval)continue;
          s.last=now;s.load=c.load;s.event=c.event;s.seatAt=null;b.hapticBusy=true;
          const level=Math.min(45,Math.max(3,(click?42:8+12*Math.log1p(c.load))*Math.max(0,Math.min(1,Number.isFinite(strength)?strength:.6))));
          const bytes=packet(level,click||impact?3:1),ch=b.hapticCharacteristic;
          try{
            const write=ch.writeValueWithResponse?ch.writeValueWithResponse(bytes):ch.writeValue(bytes);
            Promise.resolve(write).then(()=>{if(b.hapticCharacteristic!==ch)return;b.hapticLast={at:now,side,reason:click?'connector seated':c.reason,level:bytes[3]};},e=>{if(b.hapticCharacteristic!==ch)return;b.hapticError=String(e.message||e);b.hapticRetryAfter=ch.transient?now+250:null;}).finally(()=>{if(b.hapticCharacteristic===ch)b.hapticBusy=false;});
          }catch(e){b.hapticError=String(e.message||e);b.hapticRetryAfter=ch.transient?now+250:null;b.hapticBusy=false;}
        }
      }
    };
  }
  return {packet,cue,dispatcher};
});
