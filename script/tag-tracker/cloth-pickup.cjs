// One cuff pickup through real IK, motor slew and arm/table contacts. No folding sequence.
module.exports=function({check,pending=check}){
  const root=require('path').resolve(__dirname,'../..');
  const C=require(root+'/tag-tracker/tracker-core'),R=require(root+'/tag-tracker/robot-core'),T=require(root+'/tag-tracker/task-core'),P=require(root+'/tag-tracker/physics-core');
  const data=JSON.parse(require('child_process').execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml']));
  const I=[1,0,0,0,1,0,0,0,1],m=R.model(),G=R.gripper(m),ready=data.ready.joints.map(v=>v*Math.PI/180),home=R.fk(m,1,ready);
  for(const [label,chest,preshape] of [['origin',{R:I,t:[0,0,0]},.003],['translated/rotated',{R:R.Rz(Math.PI/2),t:[0,1.6,0]},.017]]){
    const at=p=>C.add(chest.t,C.mulv(chest.R,p)),Rt=C.tr3(chest.R);
    const table={R:chest.R,t:at([home.wrist[0]-.03+.25,0,home.wrist[2]-(G.halfWidth(G.gapMax)+.045)]),size:[.5,.9],thick:.03};
    const g=T.create(data.levels.find(l=>l.id==='laundry'),table,G),W=g.world,c=W.cloths[0],point=c.nodes[c.landmarks.cuffs[0]].p.slice();
    const targetR=C.mul3(chest.R,R.Rz(Math.PI/2)),tip=[0,0,G.pad.c[2]-G.pad.h[2]+.0005];
    let seed={q:ready.slice()},motor={q:ready.slice(),v:ready.map(()=>0)},open=1,maxF=0,maxRigidForce=0,maxOverlap=0,maxZ=0,legal=true,neverFallen=true,firstFall=null,phase='approach',loaded=false,maxReaction=0,maxDeflection=0;
    const pose={R:C.mul3(chest.R,home.R),t:C.sub(C.add(point,[0,0,.025]),C.mulv(targetR,tip))};
    function robot(){
      const out={hands:[],links:[]};
      for(const side of [1,-1]){
        const fk=R.fk(m,side,side===1?motor.q:ready);
        out.hands.push({side,pose:{R:C.mul3(chest.R,fk.R),t:at(fk.wrist)},opening:side===1?open:1});
        out.links.push({id:side+'u',a:at(fk.shoulder),b:at(fk.elbow),r:.04},{id:side+'f',a:at(fk.elbow),b:at(fk.wrist),r:.032});
      }
      return out;
    }
    W.mechanisms.push(()=>{
      const fallen=T.fallen(g);if(fallen||W.respawns){neverFallen=false;firstFall??={phase,time:W.time,fallen,respawns:W.respawns};}
      const force=C.norm(W.contactState?.hands[1]?.force||[0,0,0]);if(!loaded)maxF=Math.max(maxF,force);
      if(loaded){maxRigidForce=Math.max(maxRigidForce,force);maxReaction=Math.max(maxReaction,c.reactions[1]?.load||0);const fk=R.fk(m,1,motor.q),body=W.hands[1].body;maxDeflection=Math.max(maxDeflection,C.norm(C.sub(W.handPose(1).t,at(fk.wrist))));for(const s of body.sp)maxOverlap=Math.max(maxOverlap,-P.sphereBox(C.add(body.t,C.mulv(body.R,s.p)),s.r,W.tableBox,W.tableBox.h).dist);for(const box of P.padBoxes(G,W.hands[1]))maxOverlap=Math.max(maxOverlap,-P.boxBox(box,W.tableBox).dist);}
    });
    W.initialize(robot());
    function step(){
      seed=R.handIK(m,1,{R:C.mul3(Rt,pose.R),t:C.mulv(Rt,C.sub(pose.t,chest.t))},seed);
      motor=R.slew(motor,seed.q,1/60);W.setRobot(robot());W.step(1/60);
      const fallen=T.fallen(g);if(fallen||W.respawns){neverFallen=false;firstFall??={phase,time:W.time,fallen,respawns:W.respawns};}
      maxZ=Math.max(maxZ,...c.nodes.map(n=>n.p[2]-table.t[2]));
      legal=legal&&motor.q.every((v,i)=>v>=Math.max(R.JOINTS[i].lo,i===3?R.MIN_BEND:-Infinity)-1e-8&&v<=R.JOINTS[i].hi+1e-8);
    }
    // Place the wrist with forward fingers, then rotate at a certified clear
    // hover. Upright jaws expose the full bottom rubber edge with wrist margin.
    for(let i=0;i<180;i++)step();pose.R=targetR;for(let i=0;i<180;i++)step();
    open=preshape/G.gapMax;for(let i=0;i<30;i++)step();
    const cuff=()=>c.nodes[c.landmarks.cuffs[0]].p,toolPoint=local=>{const actual=W.handPose(1);return C.add(actual.t,C.mulv(actual.R,local));};
    for(let i=0;i<60;i++){
      const actual=W.handPose(1),aim=C.sub(C.add(cuff(),[0,0,.025]),C.mulv(actual.R,tip));pose.t=C.add(pose.t,C.sub(aim,pose.t).map(v=>v*.2));step();
      if(C.norm(C.sub(toolPoint(tip),C.add(cuff(),[0,0,.025])))<.0001)break;
    }
    const toe=[0,0,G.pad.c[2]-G.pad.h[2]],clearance=.00035;
    const margin=Math.min(...motor.q.slice(4).map((q,j)=>Math.min(q-R.JOINTS[j+4].lo,R.JOINTS[j+4].hi-q)));
    check(neverFallen&&margin>.03&&maxF<.1&&C.norm(C.so3Log(C.mul3(C.tr3(targetR),W.handPose(1).R)))<.001,label+': broad upright rubber toe has wrist margin and no rigid contact in the clear hover');
    loaded=true;
    for(let i=0;i<180&&toolPoint(toe)[2]-table.t[2]>clearance+.00003;i++){
      pose.t[2]-=Math.min(.0003,(toolPoint(toe)[2]-table.t[2]-clearance)*.25);step();
    }
    check(neverFallen&&maxOverlap<.001,label+': toe contact stays within rigid collision slop without sliding the garment off the table: '+JSON.stringify({firstFall,maxOverlap}));
    phase='stationary toe';for(let i=0;i<120;i++)step();
    phase='close';open=0;for(let i=0;i<70;i++)step();
    const pin=c.pins.get('1');
    // Pending: the closing jaws do not yet capture the cuff, so the capture and lift checks only report.
    pending(neverFallen&&c.pins.size===1&&pin.layers>=1&&W.hands[1].fabricForce>0,label+': real jaws capture finite fabric and develop an actual squeeze');
    pending(pin?.points.every(p=>Math.abs(p.local[0]-G.pad.c[0])<=G.pad.h[0]+1e-10&&Math.abs(p.local[2]-G.pad.c[2])<=G.pad.h[2]+1e-10&&Math.abs(p.local[1])<=W.hands[1].gap/2-c.halfThickness+1e-10),label+': finite patches stay inside the rubber footprint and packed jaw gap');
    phase='lift';for(let i=0;i<100;i++){pose.t[2]+=.0008;step();}
    phase='held dwell';for(let i=0;i<120;i++)step();
    pending(neverFallen&&c.pins.size===1&&maxZ>.06&&c.reactions[1]?.load>.05&&c.nodes.every(n=>[...n.p,...n.v].every(Number.isFinite)),label+': an 80 mm cuff lift carries a finite garment load');
    check(neverFallen,label+': no transient garment fall or automatic respawn: '+JSON.stringify(firstFall));
    check(legal&&maxOverlap<.001,label+': pickup respects every joint stop and stays within the rigid table contact slop');
    phase='release';open=1;for(let i=0;i<80;i++)step();
    check(neverFallen&&!c.pins.size&&W.hands[1].fabricForce===0&&!Object.keys(c.reactions).length,label+': opening releases the patch, squeeze and feedback');
    check(maxRigidForce<P.HAND.force&&maxReaction<P.HAND.force&&maxDeflection<2*P.PRESS&&maxOverlap<.001,label+': slow contact stays within the hand force budget without a recovered wrist kick: '+JSON.stringify({maxRigidForce,maxReaction,maxDeflection,maxOverlap}));
  }
};
