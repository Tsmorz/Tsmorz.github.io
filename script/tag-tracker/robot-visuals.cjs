// Robot render geometry only: no camera, device, dynamics or fabric playthrough.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),G=require(root+'/tag-tracker/robot-gl'),R=require(root+'/tag-tracker/robot-core');
  const near=(a,b)=>Math.abs(a-b)<1e-6,bounds=mesh=>[0,1,2].map(k=>{const values=mesh.pos.filter((_,i)=>i%3===k);return [Math.min(...values),Math.max(...values)];});
  let sound=true,grounded=true,continuous=true,eligible=true,matching=true,contrast=true;
  for(const dims of [{},{upper:.2,fore:.18,half:.12,up:.05,back:0}]){
    const m=R.model(dims),M=G.meshes(m),gripper=R.gripper(m);
    for(const floor of [undefined,-.91]){
      const layout=G.supportLayout(m,floor),A=G.actorMeshes(m,floor),post=A.amr.filter(p=>p.support==='post'),base=A.amr.find(p=>p.support==='base'),wheels=A.wheel.filter(p=>p.support==='wheel');
      continuous=continuous&&post.length===1&&layout.post.r<.04&&layout.post.h[0]===layout.post.r&&layout.post.h[1]===layout.post.r&&layout.post.c[2]-layout.post.h[2]<=layout.deck.c[2]+layout.deck.h[2]&&layout.post.c[2]+layout.post.h[2]>=m.up-.25;
      const pb=bounds(post[0].mesh),bb=bounds(base.mesh);
      grounded=grounded&&wheels.length===4&&layout.wheels.length===4&&wheels.every(p=>near(bounds(p.mesh)[2][0],layout.floor))&&layout.wheels.every(w=>near(w.c[2]-w.r,layout.floor))&&bb[2][0]>=layout.floor+.04&&layout.bumper.c[2]-layout.bumper.h[2]>=layout.floor+.04&&near(pb[2][0],layout.post.c[2]-layout.post.h[2])&&near(pb[2][1],layout.post.c[2]+layout.post.h[2])&&near(pb[0][1]-pb[0][0],layout.post.r*2)&&layout.base.h[0]>layout.post.r*4&&layout.base.h[1]>layout.post.r*4;
      for(const p of [...A.amr,...A.wheel,...M.body,...M.head,...M.upper,...M.fore,...M.foreLight,...M.hand[1],...M.hand[-1],...M.finger[1],...M.finger[-1]]){
        const {pos,nrm,idx}=p.mesh,n=pos.length/3;
        sound=sound&&n<=65535&&idx.every(i=>i<n)&&[...pos,...nrm].every(Number.isFinite)&&Array.from({length:n},(_,i)=>near(Math.hypot(...nrm.slice(i*3,i*3+3)),1)).every(Boolean);
      }
    }
    eligible=eligible&&[...M.upper,...M.fore,...M.foreLight,...M.body,...M.head].every(p=>!p.grip)&&[1,-1].every(side=>M.finger[side].every(p=>p.grip)&&M.finger[side].filter(p=>p.tip).length===1&&M.hand[side].filter(p=>p.grip).length===2&&M.hand[side].some(p=>!p.grip));
    contrast=contrast&&M.body.some(p=>p.mat==='robotDark'&&bounds(p.mesh)[0][1]>-.03&&bounds(p.mesh)[2][1]-bounds(p.mesh)[2][0]>.2)&&M.upper.filter(p=>p.mat==='robotDark').length>=2&&M.fore.some(p=>p.mat==='robotDark')&&[1,-1].every(side=>M.finger[side].filter(p=>!p.tip).every(p=>p.mat==='robotDark')&&M.hand[side].some(p=>p.grip&&p.mat==='robotDark'));
    for(const side of [1,-1])for(const p of M.finger[side]){
      const shape=p.tip?gripper.pad:gripper.finger,b=bounds(p.mesh),c=shape.c.map((v,i)=>i===1?v*side:v);
      matching=matching&&b.every((range,i)=>near(range[0],c[i]-shape.h[i])&&near(range[1],c[i]+shape.h[i]));
    }
  }
  check(continuous,'one thin continuous round mast joins the low AMR deck directly to the torso at either floor height');
  check(grounded,'four AMR tires meet the floor while the broad chassis and bumper retain at least 40 mm ground clearance');
  check(sound,'new support, head and arm meshes retain finite vertices, unit normals and valid 16-bit indices');
  check(eligible,'whole finger assemblies, pads, palm and travel rail highlight without recruiting the wrist motor or arm');
  check(matching,'finger and pad render bounds still match both mirrored physical gripper boxes');
  check(contrast&&G.robotPalette.dark==='#24282e'&&G.lin(G.robotPalette.metal)[2]>=G.lin(G.robotPalette.metal)[0]&&G.lin(G.robotPalette.shell)[2]>=G.lin(G.robotPalette.shell)[0],'silver and neutral-white robot surfaces retain black chest panels, joints, fingers and rail accents');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
