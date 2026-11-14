// Full phone-charging task through robot IK/motors, plus local completion-time ranking.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);},until=async(fn,msg,ms=5000)=>{const t=performance.now();while(!fn()&&performance.now()-t<ms)await wait(40);assert(fn(),msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setCampaignMode('guided');taskLevel('cable');await wait(500);SCORE.player='Robot demo';
  const W=TB.world,g=TB.game,vec=p=>C.mulv(W.table.R,p),at=p=>C.add(W.table.t,vec(p)),ds={};
  for(const side of [1,-1])ds[side]=driveOf(RB.scene.arms.find(a=>a.side===side));
  const move=async(side,to,ms=1300)=>{ds[side].t=to;await wait(ms);};
  const grab=async(side,b,local,extra=0)=>{
    const d=ds[side];d.open=1;await move(side,C.add(d.t,vec([0,0,.20])),1000);d.R=W.table.R.slice();await wait(700);
    const p=C.add(W.poseOf(b).t,C.mulv(b.R,local));await move(side,C.add(p,vec([0,0,.21])));await move(side,C.add(p,vec([0,0,.0925+extra])));d.open=0;
    await until(()=>W.hands[side].grip?.body===b,'actual robot grasps '+b.key+': '+JSON.stringify({hand:W.handPose(side),prop:W.poseOf(b),reach:RB.scene.arms.find(a=>a.side===side).reach}));
  };
  const track=async(side,b,target,ms,rotation=()=>W.table.R)=>{
    const d=ds[side],start=performance.now();while(performance.now()-start<ms){const p=W.poseOf(b),err=C.sub(target(),p.t),delta=C.rodrigues(PHYS.rotvec(C.mul3(rotation(),C.tr3(p.R))).map(v=>v*.04));d.t=C.add(C.add(p.t,C.mulv(delta,C.sub(d.t,p.t))),err.map(v=>Math.max(-.00025,Math.min(.00025,v*.08))));d.R=C.mul3(delta,d.R);await wait(30);}
  };
  const charger=g.byKey.get('charger'),phone=g.byKey.get('phone'),plug=g.byKey.get('plug'),outlet=W.poseOf(g.byKey.get('outlet')).t;
  await grab(-1,charger,[0,0,0],.012);await move(-1,C.add(ds[-1].t,vec([0,0,.12])));
  const pre=C.add(outlet,vec([-.044,0,0]));await move(-1,C.add(pre,C.sub(ds[-1].t,W.poseOf(charger).t)));await track(-1,charger,()=>pre,2200);
  await track(-1,charger,()=>C.add(outlet,vec([-.022,0,0])),4200);if(!charger.insertion.seated)await track(-1,charger,()=>C.add(outlet,vec([-.022,0,0])),6000);assert(charger.insertion.seated,'the real robot seats both charger pins: '+JSON.stringify(charger.insertion));ds[-1].open=1;
  await until(()=>g.steps[0],'the released charger remains supported by the outlet');await move(-1,C.add(ds[-1].t,vec([0,0,.12])));
  await grab(1,phone,[-.015,0,0],.004);await move(1,C.add(ds[1].t,vec([0,0,.09])));assert(g.charging.held&&!g.complete,'the phone is physically held clear of its cradle');
  await grab(-1,plug,[-.012,0,0]);await move(-1,C.add(ds[-1].t,vec([0,0,.10])));
  const socket=depth=>C.add(W.poseOf(phone).t,C.mulv(phone.R,[-.078-depth,0,0]));
  await move(-1,C.add(socket(.04),C.sub(ds[-1].t,W.poseOf(plug).t)));await track(-1,plug,()=>socket(.04),2000,()=>phone.R);await track(-1,plug,()=>socket(.020),4200,()=>phone.R);if(!plug.insertion.seated||!g.charging.paired)await track(-1,plug,()=>socket(.020),8000,()=>phone.R);
  await until(()=>plug.insertion.seated&&g.charging.paired,'the phone accepts USB-C while both actual robot grippers hold the assembly: '+JSON.stringify({insert:plug.insertion,phone:W.poseOf(phone),plug:W.poseOf(plug),charging:g.charging}));
  ds[-1].open=1;await until(()=>g.complete,'releasing the USB plug while holding the phone completes charging',6500);
  assert(g.steps.every(Boolean)&&W.capped===0,'the full physical charging sequence has no angular clipping');
  const rank=TaskScores.ranking(SCORE.rows,g.level,'guided');assert(rank.some(r=>r.player==='Robot demo'&&r.seconds>0)&&$('taskFastest').textContent.includes('Best time'),'completion records and displays a real best time');
  $('taskLeaderboard').open=true;
  assert(document.documentElement.scrollWidth<=innerWidth+1,'task and leaderboard fit the viewport');
  return {passed:true,wallCharger:true,movablePhone:true,twoHandedInsertion:true,realRobotIK:true,leaderboard:rank[0],viewport:[innerWidth,innerHeight]};
})()
