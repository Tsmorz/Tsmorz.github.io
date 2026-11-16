// Robot render geometry only: no camera, device, dynamics or fabric playthrough.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),G=require(root+'/tag-tracker/robot-gl'),R=require(root+'/tag-tracker/robot-core'),C=require(root+'/tag-tracker/tracker-core');
  const near=(a,b)=>Math.abs(a-b)<1e-6,bounds=mesh=>[0,1,2].map(k=>{const values=mesh.pos.filter((_,i)=>i%3===k);return [Math.min(...values),Math.max(...values)];});
  check(G.beerOpacity(0)===0&&G.beerOpacity(.001)<G.beerOpacity(.004)&&G.beerOpacity(.004)<G.beerOpacity(.08)&&G.beerOpacity(.08)<=.98,'beer attenuation depends on actual depth: thin streams transmit more light than a deep cloudy glass');
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  let sound=true,grounded=true,continuous=true,eligible=true,matching=true,contrast=true,standing=true,linkage=true,compressed=true;
  for(const dims of [{},{upper:.2,fore:.18,half:.12,up:.05,back:0}]){
    const m=R.model(dims),M=G.meshes(m),gripper=R.gripper(m);
    const floor=R.fk(m,1,R.HOME).wrist[2]-gripper.halfWidth(gripper.gapMax)-.045-.75,preview=G.supportLayout(m),task=G.supportLayout(m,floor);
    standing=standing&&near(preview.floor,floor)&&near(preview.post.h[2],task.post.h[2]);
    for(const floor of [undefined,-.91]){
      const layout=G.supportLayout(m,floor),A=G.actorMeshes(m,floor),post=A.amr.filter(p=>p.support==='post'),base=A.amr.find(p=>p.support==='base'),wheels=A.wheel.filter(p=>p.support==='wheel');
      continuous=continuous&&post.length===1&&layout.post.r<.04&&layout.post.h[0]===layout.post.r&&layout.post.h[1]===layout.post.r&&layout.post.c[2]-layout.post.h[2]<=layout.deck.c[2]+layout.deck.h[2]&&layout.post.c[2]+layout.post.h[2]>=m.up-.25;
      const pb=bounds(post[0].mesh),bb=bounds(base.mesh);
      grounded=grounded&&wheels.length===4&&layout.wheels.length===4&&wheels.every(p=>near(bounds(p.mesh)[2][0],layout.floor))&&layout.wheels.every(w=>near(w.c[2]-w.r,layout.floor))&&bb[2][0]>=layout.floor+.04&&layout.bumper.c[2]-layout.bumper.h[2]>=layout.floor+.04&&near(pb[2][0],layout.post.c[2]-layout.post.h[2])&&near(pb[2][1],layout.post.c[2]+layout.post.h[2])&&near(pb[0][1]-pb[0][0],layout.post.r*2)&&layout.base.h[0]>layout.post.r*4&&layout.base.h[1]>layout.post.r*4;
      for(const p of [...A.amr,...A.wheel,...M.body,...M.head,...M.upper,...M.fore,...M.foreLight,...M.hand[1],...M.hand[-1],...M.finger[1],...M.finger[-1],...M.linkages]){
        const {pos,nrm,idx}=p.mesh,n=pos.length/3;
        sound=sound&&n<=65535&&idx.every(i=>i<n)&&[...pos,...nrm].every(Number.isFinite)&&Array.from({length:n},(_,i)=>near(Math.hypot(...nrm.slice(i*3,i*3+3)),1)).every(Boolean);
      }
    }
    eligible=eligible&&[...M.upper,...M.fore,...M.foreLight,...M.body,...M.head].every(p=>!p.grip)&&M.linkages.every(p=>p.grip)&&[1,-1].every(side=>M.finger[side].every(p=>p.grip)&&M.finger[side].filter(p=>p.tip).length===1&&M.hand[side].filter(p=>p.grip).length>=2&&M.hand[side].some(p=>!p.grip));
    contrast=contrast&&M.body.some(p=>p.mat==='robotDark'&&bounds(p.mesh)[0][1]>-.03&&bounds(p.mesh)[2][1]-bounds(p.mesh)[2][0]>.2)&&M.upper.filter(p=>p.mat==='robotDark').length>=2&&M.fore.some(p=>p.mat==='robotDark')&&[1,-1].every(side=>M.finger[side].filter(p=>!p.tip).every(p=>p.mat==='robotDark')&&M.hand[side].some(p=>p.grip&&p.mat==='robotDark'));
    for(const side of [1,-1])for(const p of M.finger[side]){
      const shape=p.tip?gripper.pad:gripper.finger,b=bounds(p.mesh),c=shape.c.map((v,i)=>i===1?v*side:v);
      matching=matching&&b.every((range,i)=>near(range[0],c[i]-shape.h[i])&&near(range[1],c[i]+shape.h[i]));
    }
    for(const gap of [0,gripper.gapMax/2,gripper.gapMax]){
      const layout=G.gripperLayout(m,gap),left=layout.fingers[0],right=layout.fingers[1];
      linkage=linkage&&layout.body.type==='cylinder'&&near(layout.body.r*2,.075)&&near(gripper.gapMax,.085)&&near(left.pad.c[1],-right.pad.c[1])&&near(left.pad.c[2],gripper.pad.c[2])&&layout.fingers.every(j=>j.segments.every(s=>Math.abs(s.a[0])>gripper.finger.h[0]));
      for(const p of M.linkages){
        const pose=G.gripperPartPose(p,layout),jaw=layout.fingers.find(j=>j.side===p.jaw),s=p.link!==undefined?jaw.segments[p.link]:jaw.joints[p.joint];
        for(let i=0;i<p.mesh.pos.length;i+=3){
          const v=C.add(pose.t,C.mulv(pose.R,[...p.mesh.pos.slice(i,i+3)]));let distance;
          if(s.a){const d=C.sub(s.b,s.a),f=Math.max(0,Math.min(1,dot(C.sub(v,s.a),d)/dot(d,d)));distance=C.norm(C.sub(v,C.add(s.a,d.map(x=>x*f))));}
          else distance=C.norm(C.sub(v,s.p));
          linkage=linkage&&v.every(Number.isFinite)&&distance<=s.r+1e-6;
        }
      }
    }
    const closed=G.gripperPartPose(M.linkages[0],G.gripperLayout(m,0)),opened=G.gripperPartPose(M.linkages[0],G.gripperLayout(m,gripper.gapMax));
    linkage=linkage&&C.norm(C.sub(closed.t,opened.t))>.005;
    for(const carrierGap of [.001,.04]){
      const state={carrierGap,padCompression:{1:[.001,-.0008,-.0005],'-1':[-.0004,.0003,.0002]}},layout=G.gripperLayout(m,carrierGap+.0011,state);
      compressed=compressed&&layout.fingers.every(j=>j.pad.h.every((v,k)=>v<gripper.pad.h[k]));
      for(const side of [1,-1])for(const part of M.finger[side]){
        const pose=G.gripperFingerPose(part,side,layout),jaw=layout.fingers.find(j=>j.side===side),shape=part.tip?jaw.pad:jaw.backbone,scale=pose.scale||[1,1,1];
        const coordinates=[[],[],[]];for(let i=0;i<part.mesh.pos.length;i+=3){const point=C.add(pose.t,C.mulv(pose.R,scale.map((v,k)=>v*part.mesh.pos[i+k])));point.forEach((v,k)=>coordinates[k].push(v));}
        compressed=compressed&&coordinates.every((values,k)=>near(Math.min(...values),shape.c[k]-shape.h[k])&&near(Math.max(...values),shape.c[k]+shape.h[k]));
      }
    }
  }
  check(continuous,'one thin continuous round mast joins the low AMR deck directly to the torso at either floor height');
  check(grounded,'four AMR tires meet the floor while the broad chassis and bumper retain at least 40 mm ground clearance');
  check(standing,'default preview standing floor and mast height match a fresh task before any table exists');
  check(sound,'new support, head and arm meshes retain finite vertices, unit normals and valid 16-bit indices');
  check(eligible,'complete finger, pad, housing and articulated link assemblies highlight without recruiting the wrist motor or arm');
  check(matching,'finger and pad render bounds still match both mirrored physical gripper boxes');
  check(contrast&&G.robotPalette.dark==='#24282e'&&G.lin(G.robotPalette.metal)[2]>=G.lin(G.robotPalette.metal)[0]&&G.lin(G.robotPalette.shell)[2]>=G.lin(G.robotPalette.shell)[0],'silver and neutral-white robot surfaces retain black chest panels, joints, fingers and rail accents');
  check(linkage,'75 mm Robotiq-style housing and 85 mm animated jaws preserve pad depth; exposed side links/joints remain inside their shared collision capsules and spheres');
  check(compressed,'asymmetric rubber compression deforms the displayed pads within their actual collision boxes while metal and linkages follow the carrier stroke');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
