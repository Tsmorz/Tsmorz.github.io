// A movable phone socket and mains charger, with genuine opposing insertion forces and two-handed evidence.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./tracker-core'),require('./cable-core'));else root.ChargingCore=factory(root.TagCore,root.CableCore);})(typeof self!=='undefined'?self:this,function(C,Cable){
  'use strict';
  function attach(g){
    const W=g.world,s=g.level.charging,charger=g.byKey.get(s.charger),plug=g.byKey.get(s.plug),outlet=g.byKey.get(s.outlet),phone=g.byKey.get(s.phone),state={wallDwell:0,pairDwell:0,paired:false,powered:false,approachAt:null};g.charging=state;
    const held=b=>Object.entries(W.hands).filter(([,h])=>h.grip?.body===b).map(([side])=>+side),wall={kind:'mains'},usb={at:s.socket_at};
    W.contactGenerators.push(()=>Cable.mainsContacts(W,charger,outlet,wall),()=>Cable.sleeveContacts(W,plug,phone,usb));
    W.mechanisms.push(dt=>{
      charger.insertion=Cable.insertion(W,charger,outlet,wall);plug.insertion=Cable.insertion(W,plug,phone,usb);
      const plugged=charger.insertion.seated,inserted=plug.insertion.seated,ph=held(phone),right=held(plug),raised=g.local(W.poseOf(phone).t)[2]>.08;
      state.wallDwell=plugged&&!held(charger).length?state.wallDwell+dt:0;
      const both=raised&&ph.some(side=>right.some(other=>other!==side));
      if(!both||!plugged)state.approachAt=null;
      else if(plug.insertion.depth<.003)state.approachAt=W.time;
      const crossed=state.approachAt!=null&&plug.insertion.clickAt!=null&&plug.insertion.clickAt>=state.approachAt;
      state.pairDwell=plugged&&inserted&&both&&crossed?state.pairDwell+dt:0;
      if(state.pairDwell>.10)state.paired=true;
      if(!charger.insertion.latched||!plug.insertion.latched)state.paired=false;
      state.powered=plugged&&inserted;phone.charging=state.powered;
      state.held=ph.length>0&&raised;state.plugHeld=right.length>0;
      state.relativeSpeed=C.norm(C.sub(plug.v,phone.v));
    });
    const reset=g.reset;g.reset=()=>{reset();Object.assign(state,{wallDwell:0,pairDwell:0,paired:false,powered:false,approachAt:null,held:false,plugHeld:false});phone.charging=false;};
    return state;
  }
  function guidance(g){const s=g.charging;if(s.wallDwell<.3)return g.byKey.get(g.level.charging.charger).insertion?.seated?'charger_release':'charger_outlet';if(!s.held)return 'phone_pickup';if(!g.byKey.get(g.level.charging.plug).insertion?.seated)return 'phone_insert';if(!s.paired)return s.approachAt==null?'phone_regrasp':'phone_seat_wait';if(s.plugHeld)return 'phone_release';return 'phone_hold';}
  function complete(g){const s=g.charging;return s.wallDwell>.3&&s.powered&&s.paired&&s.held&&!s.plugHeld&&s.relativeSpeed<.04;}
  return {attach,guidance,complete};
});
