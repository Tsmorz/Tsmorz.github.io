// Finite fabric pinch, cut-pattern topology, sleeve/body objectives and a physical shirt playthrough.
module.exports = function ({check}) {
  const root=require('path').resolve(__dirname,'../..'),C=require(root+'/tag-tracker/tracker-core'),R=require(root+'/tag-tracker/robot-core'),P=require(root+'/tag-tracker/physics-core'),T=require(root+'/tag-tracker/task-core'),Cloth=require(root+'/tag-tracker/cloth-core'),GL=require(root+'/tag-tracker/robot-gl');
  const data=JSON.parse(require('child_process').execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'])),I=[1,0,0,0,1,0,0,0,1],table={R:I,t:[0,0,0],size:[.5,.9],thick:.03},G=R.gripper(R.model());
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=v=>v.map(x=>x/C.norm(v));
  const W0=P.world({table,gripper:G}),cloth=Cloth.towel({key:'test',at:[0,0,0],resolution:13},table);W0.cloths.push(cloth);
  let wrist=[0,0,.13],rotation=I,opening=1;
  const frame0=()=>{W0.setRobot({hands:[{side:1,pose:{R:rotation,t:wrist},opening}]});W0.step(1/60);},run0=n=>{for(let i=0;i<n;i++)frame0();};
  run0(20);opening=0;frame0();check(cloth.pins.size===0,'a close command cannot magnetically capture fabric while the jaws are still open');run0(40);
  const pin=cloth.pins.get('1');check(!!pin,'closed pads capture the fabric');if(!pin)throw Error('fabric capture failed');
  for(let i=0;i<60;i++){wrist=C.add(wrist,[0,0,.002]);frame0();}
  const point=q=>q.ids.reduce((p,i,k)=>C.add(p,cloth.nodes[i].p.map(v=>v*q.w[k])),[0,0,0]);
  const centre=cloth.nodes[pin.i].p;
  for(const n of cloth.nodes){const d=C.sub(n.p,centre);n.v=[-8*d[1],8*d[0],0];}
  let error=0;
  for(let i=0;i<90;i++){
    frame0();if(!cloth.pins.has('1'))break;
    const pose=W0.handPose(1),actual=unit(C.sub(point(pin.points[1]),point(pin.points[0]))),expected=unit(C.mulv(pose.R,C.sub(pin.points[1].local,pin.points[0].local)));
    error=Math.max(error,Math.acos(Math.max(-1,Math.min(1,dot(actual,expected)))));
  }
  check(cloth.pins.has('1')&&error<.25,'a stationary gripper resists a spinning fabric patch ('+(error*180/Math.PI).toFixed(1)+' degrees maximum)');
  for(let i=1;i<=60;i++){rotation=R.Rz(Math.PI/2*i/60);frame0();}
  const pose=W0.handPose(1),actual=unit(C.sub(point(pin.points[1]),point(pin.points[0]))),expected=unit(C.mulv(pose.R,C.sub(pin.points[1].local,pin.points[0].local)));
  check(dot(actual,expected)>.97&&cloth.reactions[1]?.torque.every(Number.isFinite),'turning the wrist rotates the material patch and supplies a finite reaction torque');
  opening=.15;frame0();check(!cloth.pins.size,'opening the jaws releases the patch without needing to pull it free');
  const inside=Cloth.faceContact([.02,.02,.001],[0,0,0],[.04,0,0],[0,.04,0]);
  check(inside&&Math.abs(inside.d-.001)<1e-9&&Cloth.faceContact([.04,.04,.001],[0,0,0],[.04,0,0],[0,.04,0])===null,'surface contacts distinguish a triangle interior from the empty space outside its edges');
  const raw=data.levels.find(l=>l.id==='laundry'),g=T.create(T.mission(raw,'guided'),table,G),W=g.world,c=W.cloths[0],poses={};
  const step=()=>{W.setRobot({hands:Object.entries(poses).map(([side,p])=>({side:+side,pose:{R:p.R,t:p.t},opening:p.open}))});W.step(1/60);T.update(g,1/60,true);};
  const run=n=>{for(let i=0;i<n;i++)step();};
  const pinch=(side,i)=>{const at=c.nodes[i].p.slice();poses[side]={R:I,t:C.add(at,[0,0,.12]),open:1};run(20);poses[side].open=0;run(40);const pin=c.pins.get(String(side));check(!!pin,'real gripper captures '+(i===c.landmarks.cuffs[0]?'left cuff':i===c.landmarks.cuffs[1]?'right cuff':'a hem corner'));if(!pin)throw Error('shirt pinch failed');return pin;};
  check(raw.revision===2&&c.kind==='shirt'&&c.landmarks.sleeves.every(s=>s.length>0)&&c.material.some(p=>p[1]>.20)&&c.material.some(p=>p[1]<-.20),'the revised task has two genuine long sleeves and separate garment landmarks');
  check(!c.triangles.some((_,t)=>t%3===0&&Cloth.faceContact([.133,0,0],...c.triangles.slice(t,t+3).map(i=>c.material[i]))),'the neckline is an opening in the mesh');
  const mesh=GL.clothMesh(c);check([...mesh.pos,...mesh.nrm].every(Number.isFinite)&&mesh.idx.every(i=>i<c.nodes.length),'the cut-pattern garment renders with finite indexed geometry');
  run(30); // Section 5j measures the shared physics-frame budget with the other task scenes.
  check(!g.complete&&T.guidance(g).state==='shirt_left','an unfolded shirt starts with the left sleeve');
  for(const [idx,side]of [[0,1],[1,-1]]){
    const pin=pinch(side,c.landmarks.cuffs[idx]),from=c.nodes[pin.i].p.slice(),p=poses[side],target=[from[0],idx===0?-.04:.04,.012];
    for(let i=0;i<=150;i++){const u=i/150,t=u*u*(3-2*u);p.R=R.Rx((idx===0?-1:1)*Math.PI/2*t);const at=from.map((v,k)=>v+(target[k]-v)*t);at[2]+=.09*Math.sin(Math.PI*t);p.t=C.sub(at,C.mulv(p.R,pin.local));step();}
    p.open=1;run(120);delete poses[side];
    check(Cloth.folded(c).sleeves[idx]&&!g.complete,'the '+(idx===0?'left':'right')+' sleeve folds, releases and stays inside the torso');
    check(T.guidance(g).state===(idx===0?'shirt_right':'shirt_hem'),'guidance advances only after the sleeve is tucked in and released');
  }
  for(const [idx,side]of [[0,1],[1,-1]])pinch(side,c.landmarks.hem[idx]);
  const starts=Object.entries(poses).map(([s,p])=>({s,p,pin:c.pins.get(s),from:c.nodes[c.pins.get(s).i].p.slice()}));
  for(let i=0;i<=180;i++){const u=i/180,t=u*u*(3-2*u);for(const {p,pin,from}of starts){p.R=R.Ry(-Math.PI/2*t);p.t=C.sub(C.add(from,[.28*t,0,.095*Math.sin(Math.PI*t)]),C.mulv(p.R,pin.local));}step();}
  check(!g.complete&&c.pins.size===2,'a folded shirt still held by the grippers cannot complete');
  for(const p of Object.values(poses))p.open=1;for(let i=0;i<480&&!g.complete;i++)step();
  check(g.complete&&Cloth.folded(c).complete&&c.pins.size===0&&c.touched.size===2&&W.capped===0,'two physical grippers fold both sleeves and the body, then release a settled shirt on its pad: '+JSON.stringify({fold:Cloth.folded(c),steps:g.steps,velocity:Math.max(...c.nodes.map(n=>C.norm(n.v))),pins:c.pins.size,guide:T.guidance(g)}));
  const stretch=Math.max(...c.edges.filter(e=>e.compliance<1e-6).map(e=>C.norm(C.sub(c.nodes[e.a].p,c.nodes[e.b].p))/e.rest));
  check(stretch<1.15&&c.nodes.every(n=>n.p[2]>=Cloth.radius-.0001),'the folded shirt keeps stretch bounded and stays above the tabletop: '+JSON.stringify({stretch,z:Math.min(...c.nodes.map(n=>n.p[2]))}));
  g.reset();for(const n of c.nodes)n.p=[.015,0,.01];c.touched=new Set([1,-1]);T.update(g,1,true);check(!g.complete,'a crumpled point cannot substitute for sleeves and a body fold');
  g.reset();check(!g.complete&&!c.pins.size&&!c.touched.size&&T.guidance(g).state==='shirt_left','restart restores the shirt cut pattern and clears all pin, fold and objective state');
};
