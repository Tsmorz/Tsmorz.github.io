// TP/1 and leaderboard tests: real byte streams, C/JS parity, CRC recovery, ACK gating, timeout and disconnect.
module.exports=async function({check}){
  const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),root=path.resolve(__dirname,'../..'),L=require(root+'/tag-tracker/controller-link'),Scores=require(root+'/tag-tracker/score-core'),C=require(root+'/tag-tracker/tracker-core'),T=require(root+'/tag-tracker/task-core');
  const f={type:5,board:0x1234,seq:65535,stamp:0xabcdef01,pipe:1,payload:[2,2,3,35,0,0]},received=[],p=L.parser(f=>received.push(f));
  check(Buffer.from(L.frame(f)).toString('hex')==='0013545001053412ffff01efcdab0106020203230103116b00','USB command matches the fixed TP/1 protocol reference bytes');
  for(let len=0;len<=64;len++){const bytes=L.frame({...f,payload:Array.from({length:len},(_,i)=>i%3?i:0)});for(const x of bytes)p.push([x]);}
  check(received.length===65&&received.every((x,i)=>x.payload.length===i),'USB framing survives every payload size, zeros and one-byte reads');
  const bad=L.frame(f);bad[9]^=1;p.push(bad);p.push(new Uint8Array(400).fill(7));p.push([0]);p.push(L.frame(f));
  check(p.stats.bad>=2&&received.at(-1).board===0x1234,'CRC and bounded overflow reject noise and recover at the next frame');
  const firmware=path.resolve(root,'../nrf-controller'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tp-wire-'));
  if(fs.existsSync(firmware+'/src/teleop_wire.c')){
    try{cp.execFileSync('cc',['-std=c11','-I',firmware+'/src',firmware+'/tests/firmware/test_teleop_wire.c',firmware+'/src/teleop_wire.c',firmware+'/src/teleop_policy.c','-o',tmp+'/wire']);cp.execFileSync(tmp+'/wire',[tmp+'/frame']);check(Buffer.from(L.frame(f)).equals(fs.readFileSync(tmp+'/frame')),'C firmware and browser encode exactly the same USB command bytes');}finally{fs.rmSync(tmp,{recursive:true,force:true});}
  }
  let control,writes=[],dropAck=false;
  const port={open:async options=>{port.options=options;},close:async()=>{if(port.closed)throw new Error('Port closed twice');port.closed=true;},readable:new ReadableStream({start(c){control=c;}}),writable:new WritableStream({write(bytes){writes.push(bytes);const parse=L.parser(q=>{if(q.type===L.TYPE.COMMAND&&!dropAck)queueMicrotask(()=>control.enqueue(L.frame({type:L.TYPE.ACK,board:q.board,payload:[q.seq&255,q.seq>>8,0]})));});parse.push(bytes);}})};
  const link=new L.Serial(port,()=>{});await link.open();link.stamps.set(0x1234,12345);await link.command(0x1234,1,new Uint8Array([2,2,1,20,0,0]));
  check(port.options.baudRate===1000000&&Number.isFinite(link.rtt)&&writes.length===2,'Web Serial opens at 1 Mbaud and waits for the matching application ACK');
  dropAck=true;let timed=false;try{await link.command(0x1234,1,new Uint8Array([2,2,1,20,0,0]));}catch(e){timed=/timed out/.test(e.message);}
  check(timed&&link.pending.size===0,'missing acknowledgements time out without retaining a command queue');
  const pending=link.command(0x1234,1,new Uint8Array([2,2,1,20,0,0]));let disconnected=false;const rejected=pending.catch(e=>{disconnected=/disconnected/.test(e.message);});await Promise.all([link.close(),link.close()]);await rejected;
  check(disconnected&&port.closed&&link.pending.size===0,'disconnect rejects in-flight feedback and releases the serial port');
  const level={id:'a'},mode='guided';let rows=[];rows=Scores.record(rows,level,mode,'Sam',8.125,1);rows=Scores.record(rows,level,mode,'Jo',6.5,2);rows=Scores.record(rows,level,mode,'Sam',9,3);rows=Scores.record(rows,level,mode,'Sam',7,4);
  check(Scores.ranking(rows,level,mode).map(r=>r.player+':'+r.seconds).join(',')==='Jo:6.5,Sam:7','leaderboard ranks each player’s best completion only');
  check(!Scores.ranking(rows,level,'practice').length&&!Scores.ranking(rows,{id:'a',revision:2},mode).length,'full/small tasks and changed challenge revisions never mix times');
  check(Scores.clean([{task:'a',seconds:NaN,at:1}]).length===0&&Scores.format(61.234)==='1:01.234','invalid scores are dropped and best times retain millisecond precision');
  const yaml=JSON.parse(cp.execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'])),R=require(root+'/tag-tracker/robot-core'),I=[1,0,0,0,1,0,0,0,1],g=T.create(yaml.levels.find(l=>l.id==='bowl'),{R:I,t:[0,0,0],size:[.5,.9]},R.gripper(R.model()));
  const migrated=T.progress({cable:{stars:3,time:12}},yaml.levels),current=T.progress({cable:{stars:2,time:40,revision:2}},yaml.levels);check(migrated.connector?.time===12&&!migrated.cable&&current.cable?.time===40&&!current.connector,'old fixed-socket personal bests migrate to connector practice without contaminating the phone ranking');
  T.update(g,.01,true,10);T.update(g,.01,true,15);check(g.elapsed===5,'ranked completion time uses monotonic elapsed time, not a capped physics frame count');g.reset();check(g.clockStart==null&&g.elapsed===0,'restart clears the completion clock');
};
