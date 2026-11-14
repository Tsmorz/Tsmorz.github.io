// Clean tray balancing through the actual rendered robot, IK and motor slew.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const until=async(fn,msg,ms=6500)=>{const start=performance.now();while(!fn()&&performance.now()-start<ms)await wait(40);assert(fn(),msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setCampaignMode('guided');taskLevel('tray');await wait(500);
  const W=TB.world,g=TB.game,T=W.table,at=p=>C.add(T.t,C.mulv(T.R,p)),drives=Object.fromEntries([1,-1].map(s=>[s,driveOf(RB.scene.arms.find(a=>a.side===s))]));
  let x=-.105,z=.13;
  const aim=()=>{for(const [side,d]of Object.entries(drives)){d.R=T.R.slice();d.t=at([x,+side*.186,z]);}};
  for(const d of Object.values(drives)){d.open=1;d.t=C.add(d.t,C.mulv(T.R,[0,0,.15]));}await wait(900);aim();await wait(1800);for(const d of Object.values(drives))d.open=0;
  await until(()=>[1,-1].every(s=>W.hands[s].grip?.body.key==='tray'),'both actual robot grippers must hold a side rim');
  const motion=async(seconds,fn)=>{const start=W.time;while(W.time-start<seconds){const u=Math.min(1,(W.time-start)/seconds);fn(u*u*(3-2*u));aim();await wait(16);}fn(1);aim();};
  await motion(2,t=>{z=.13+.09*t;});await until(()=>g.steps[0],'an elevated clean hold must satisfy balancing');
  await motion(3,t=>{x=-.105+.12*t;});await motion(2,t=>{z=.22-.09*t;});for(const d of Object.values(drives))d.open=1;
  await until(()=>g.complete,'a clean set-down and release completes balancing');
  assert(!g.balance.rimHit&&g.steps.every(Boolean)&&W.capped===0,'the actual robot keeps the ball clear of the rims throughout');
  return {passed:true,realRobotIK:true,twoHands:true,cleanBallBalance:true,releasedAndSettled:true};
})()
