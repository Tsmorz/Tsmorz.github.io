// Finite fabric pinch, plush layer contact and two physical towel folds.
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
  const pinch=(side,i,second=false)=>{const at=second?Cloth.handles(c).find(h=>h.side===side).point:c.nodes[i].p.slice();poses[side]={R:I,t:C.add(at,[0,0,.105]),open:1};run(20);poses[side].open=0;run(40);const pin=c.pins.get(String(side));check(!!pin,'real gripper captures a thick towel edge');if(!pin)throw Error('towel pinch failed');return pin;};
  check(raw.revision===3&&c.kind==='towel'&&c.halfThickness===.003&&c.pile>0&&c.foldAxes==='xx','the revised task is a soft towel core with a thick plush nap with two physical half folds');
  const mesh=GL.clothMesh(c),top=Math.max(...[...mesh.pos].filter((_,i)=>i%3===2)),bottom=Math.min(...[...mesh.pos].filter((_,i)=>i%3===2));
  check([...mesh.pos,...mesh.nrm].every(Number.isFinite)&&mesh.idx.every(i=>i*3<mesh.pos.length)&&mesh.idx.length>c.triangles.length*2&&top-bottom>=.008,'the towel renders a closed thick shell with plush loft and bound edges');
  run(30);check(!g.complete&&T.guidance(g).state==='towel_first_grab','an unfolded towel asks for the first pair of corners');
  for(const [side,i]of [[1,c.N*c.N-1],[-1,c.N-1]])pinch(side,i);
  const fold=(distance,rise,second=false)=>{
    const starts=Object.entries(poses).map(([s,p])=>{const pin=c.pins.get(s),from=C.add(W.handPose(+s).t,C.mulv(W.handPose(+s).R,pin.local)),row=Math.floor(pin.i/c.N),edge=C.add(c.nodes[row*c.N].p,c.nodes[row*c.N+c.N-1].p).map(v=>v/2),crease=c.nodes[row*c.N+Math.floor(c.N/2)].p;return {s,p,pin,from,shift:second?crease[0]-from[0]:-distance};});
    for(let i=0;i<=360;i++){const u=i/360,t=u*u*(3-2*u);for(const {p,pin,from,shift}of starts){p.R=I;p.t=C.sub(C.add(from,[shift*.5*(1-Math.cos(Math.PI*t)),0,rise*Math.sin(Math.PI*t)+(second?.04:.025)*t]),C.mulv(p.R,pin.local));}step();}
  };
  fold(c.width,c.width/2);check(c.pins.size===2&&!g.complete,'the first held fold cannot complete the two-fold task');
  for(const p of Object.values(poses))p.open=1;run(240);for(const s of Object.keys(poses))delete poses[s];
  check(Cloth.folded(c).x&&!Cloth.folded(c).complete&&c.foldStage===1&&!g.complete&&T.guidance(g).state==='towel_second_grab','one real released half fold advances to regripping rather than completion');
  for(const [side,i]of [[1,(c.N-1)*c.N],[-1,0]])pinch(side,i,true);
  check([...c.pins.values()].every(p=>p.layers>=2&&p.throughFold),'each second-fold grasp clamps both physical layers, rather than pulling one corner loose');
  fold(c.width/3,c.width/4,true);check(c.pins.size===2&&!g.complete,'the four-layer towel still needs both grippers to release');
  check(Object.values(c.reactions).length===2&&Object.values(c.reactions).every(r=>r.load<=6.0001),'capturing two layers keeps each hand’s total feedback force bounded');
  for(const p of Object.values(poses))p.open=1;for(let i=0;i<480&&!g.complete;i++)step();
  const f=Cloth.folded(c),stretch=Math.max(...c.edges.filter(e=>e.compliance<1e-6).map(e=>C.norm(C.sub(c.nodes[e.a].p,c.nodes[e.b].p))/e.rest));
  check(g.complete&&f.complete&&c.pins.size===0&&c.touched.size===2&&W.capped===0,'two physical grippers make both folds, release and settle the plush towel: '+JSON.stringify({fold:f,steps:g.steps,guide:T.guidance(g)}));
  check(stretch<1.15&&c.nodes.every(n=>n.p[2]>=c.halfThickness-.0001),'the thick folded layers keep stretch bounded and stay above the table: '+JSON.stringify({stretch,height:f.span[2]}));
  g.reset();for(const n of c.nodes)n.p=[-.18,0,.01];c.touched=new Set([1,-1]);T.update(g,1,true);check(!g.complete,'a crushed bundle cannot substitute for two aligned folds');
  g.reset();check(!g.complete&&!c.pins.size&&!c.touched.size&&c.foldStage===0&&!c.firstHands.size&&!c.foldHands.size&&T.guidance(g).state==='towel_first_grab','restart restores the towel and clears both fold stages and grasp history');
  for(const side of Object.keys(poses))delete poses[side];W.setRobot({hands:[]});W.step(1/60);
  for(const [i,n]of c.nodes.entries()){const p=c.material[i];n.p=[-.21+Math.abs(p[0]),p[1],.005+(p[0]<0?.01:0)];n.v=[0,0,0];}
  pinch(1,c.N-1);check(c.pins.get('1').layers>=2&&c.pins.get('1').points.length>=6,'closed pads clamp both actual layers of a doubled edge, with one finite patch per layer');
};
