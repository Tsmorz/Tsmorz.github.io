// One cuff lift and release as an isolated mechanical specimen. Never a task-fold playthrough.
'use strict';
const root=require('path').resolve(__dirname,'../..'),Cloth=require(root+'/tag-tracker/cloth-core'),Robot=require(root+'/tag-tracker/robot-core'),C=require(root+'/tag-tracker/tracker-core'),spec=require('./cloth-mechanics.cjs').shirtSpec;
function create(resolution=13){
  const I=[1,0,0,0,1,0,0,0,1],table={R:I,t:[0,0,0],size:[.5,.9]},G=Robot.gripper(),c=Cloth.shirt({...spec,resolution,air_drag:.35},table),R=C.rodrigues([Math.PI/2,0,0]),point=c.nodes[c.landmarks.cuffs[0]].p.slice();point[2]-=c.halfThickness;
  const pose={R,t:C.sub(point,C.mulv(R,[G.pad.c[0],0,G.pad.c[2]]))},body={t:pose.t.slice(),R,sp:[],bound:.2,v:[0,0,0],w:[0,0,0]},hand={body,gap:4*c.halfThickness,target:0},W={cloths:[c],gripper:G,hands:{1:hand},handPose:()=>pose,bodies:[],robotLinks:[],gravity:[0,0,-9.81],floorZ:-10,tableBox:{t:[0,0,-.02],R:I,h:[.25,.45,.02]}};
  c.step(1/240,W);hand.fabricForce=2;return {c,W,pose,hand,body};
}
function lift(fixture,steps=96){const {c,W,pose,hand,body}=fixture,start=performance.now();for(let i=0;i<steps;i++){pose.t[2]+=.0005;body.t=pose.t.slice();body.v=[0,0,.12];c.step(1/240,W);}return {msFrame:(performance.now()-start)*4/steps,pins:c.pins.size,layers:c.pins.get('1')?.layers,zmax:Math.max(...c.nodes.map(n=>n.p[2])),load:c.reactions[1]?.load,residual:c.gripResidual,edgeContacts:c.edgePairs.length};}
function release(fixture,steps=120){const {c,W,hand,body}=fixture;hand.target=.085;hand.gap=.085;hand.fabricForce=0;body.v=[0,0,0];for(let i=0;i<steps;i++)c.step(1/240,W);return {pins:c.pins.size,zmax:Math.max(...c.nodes.map(n=>n.p[2])),finite:c.nodes.every(n=>[...n.p,...n.v].every(Number.isFinite))};}
module.exports={create,lift,release};
if(require.main===module){const repeats=process.argv.includes('--warm')?6:1;for(let i=0;i<repeats;i++){const fixture=create();console.log(JSON.stringify({run:i+1,lift:lift(fixture),release:release(fixture)}));}}
