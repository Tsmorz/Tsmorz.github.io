import P from '../../tag-tracker/physics-core.js';
import R from '../../tag-tracker/robot-core.js';

const I=[1,0,0,0,1,0,0,0,1],G=R.gripper(R.model());
export function fallingImpact({mass=.1,dt=1/60,high=false}={}){
  const world=P.world({gripper:G}),body=world.add({kind:'block',mass,pieces:[{type:'box',p:[0,0,0],h:[.015,.015,.015]}]},[0,0,high?.4:.24]);
  body.v=[0,0,high?-.4:-.25];
  const robot={hands:[{side:1,pose:{R:I,t:[0,0,.2]},opening:1}]};world.resetRobot(robot);
  for(let i=0;i<Math.ceil(2/dt);i++){
    world.setRobot(robot);world.step(dt);
    const event=world.record?.events.find(e=>[e.a.kind,e.b.kind].includes('hand')&&(e.a.id===body.id||e.b.id===body.id));
    if(event)return {world,event,averageForce:Math.hypot(...world.record.hands[1].force)};
  }
  throw Error('falling prop did not contact the real physical gripper');
}
export function handTableImpact({speed=.12,dt=1/60}={}){
  const world=P.world({table:{R:I,t:[0,0,0],size:[1,1],thick:.03},gripper:G}),z0=-(G.finger.c[2]-G.finger.h[2])+.04;
  const robot=z=>({hands:[{side:1,pose:{R:I,t:[0,0,z]},opening:1}]});world.resetRobot(robot(z0));
  for(let i=0;i<Math.ceil((.04/speed+.2)/dt);i++){
    world.setRobot(robot(z0-speed*(i+1)*dt));world.step(dt);
    const event=world.record?.events.find(e=>[e.a.kind,e.b.kind].includes('hand'));
    if(event)return {world,event};
  }
  throw Error('moving gripper did not contact the real physical table');
}
