// Controller ADPCM/wire parity, bounded audio tracks and voice command vocabulary. No devices or models.
module.exports=function({check}){
  const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process'),root=path.resolve(__dirname,'../..');
  const A=require(root+'/tag-tracker/voice-core'),C=require(root+'/tag-tracker/tracker-core');
  const packet=(id,first,bytes=[0x77,0x22],predictor=0,index=0)=>{const v=new DataView(new ArrayBuffer(10+bytes.length));v.setUint8(0,1);v.setUint16(1,id,true);v.setUint32(3,first,true);v.setInt16(7,predictor,true);v.setUint8(9,index);new Uint8Array(v.buffer).set(bytes,10);return v;};
  check([...A.start(0xcafe)].join(',')==='1,2,254,202'&&[...A.stop()].join(',')==='1,3','controller audio commands match the existing firmware protocol');
  const d=A.chunk(packet(7,320,[0x77],-123,9));check(d.id===7&&d.first===320&&d.predictor===-123&&d.index===9,'audio header uses the board stream ID, sample clock and signed ADPCM state');
  const prefixed=new Uint8Array(18);prefixed.set(new Uint8Array(packet(2,0,[0x77]).buffer),3);
  check(A.chunk(new DataView(prefixed.buffer,3,11)).id===2,'audio parsing respects nonzero DataView offsets');
  const bad=packet(1,0);bad.setUint8(9,89);check(A.chunk(bad)===null&&A.chunk(new DataView(new ArrayBuffer(10)))===null,'invalid ADPCM state and empty/truncated packets are refused');
  const take=new A.Take(7),first=take.add(packet(7,0)),repeat=take.add(packet(7,0)),gap=take.add(packet(7,8));
  check(first.length===4&&repeat===null&&gap.length===8&&gap.slice(0,4).every(x=>x===0)&&take.lost===4&&take.next===12,'missing packets become silence and repeated packets cannot duplicate speech');
  check(take.add(packet(8,12))===null&&take.add(packet(7,4))===null,'other streams and out-of-order chunks cannot enter the current take');
  let oversized=false;try{take.add(packet(7,0xffffff00));}catch(_){oversized=true;}
  // Samples outside the bounded take are ignored without allocating the advertised timestamp gap.
  check(!oversized&&take.next===12,'an enormous sample counter cannot allocate an enormous silence buffer');
  let interrupted=false;try{new A.Take(1).add(packet(1,40000));}catch(_){interrupted=true;}
  check(interrupted,'a substantial in-window discontinuity aborts the utterance');
  const bounded=new A.Take(9,8000);for(let i=0;i<bounded.limit;i+=1000)bounded.add(packet(9,i,new Array(500).fill(0x21)));bounded.add(packet(9,bounded.limit));
  check(bounded.full&&bounded.next===240000&&bounded.finish().length===480000,'controller recordings stop at thirty seconds and resample to Whisper’s 16 kHz input');
  check(take.finish().length===12&&take.finish().every(x=>Number.isFinite(x)&&x>=-1&&x<1),'Whisper receives finite normalised mono PCM');
  let invalid=false;try{new A.Take(1,65535);}catch(_){invalid=true;}check(invalid,'unreasonable microphone sample rates are rejected');
  const info=C.encodeBoardInfo(0x1234,208,.07,.000244);info.setUint16(13,16000,true);check(C.decodeBoardInfo(info).micRateHz===16000,'controller metadata supplies the actual microphone rate');
  for(const [phrase,command]of [['Tasks.','tasks'],['Restart task.','table'],['Robot eyes.','eyes'],['Outside view.','outside'],['Next task.','next'],['Resume AprilTags.','tags']])check(C.voiceCommand(phrase)?.cmd===command,phrase+' routes to a page command');
  check(C.voiceCommand('The next task is tricky.')===null&&C.voiceCommand('Note: restart task').cmd==='note','ordinary dictation never triggers an embedded task command');
  const reference=[-11,-41,-104,-240,-533,-1164,-2521,1,3780,7302,10504,14246,17768,20970,24712,17164,984,-15203,-8897,-6986,-5249,-512,3794,7709,11268,14503,17444,21901,24332,13282,-10407,-13792];
  check(A.decode(Buffer.from('ffffff6f354333f4bf0110111121f18f','hex'),0,0).every((x,i)=>x===reference[i]),'the decoder matches a fixed firmware-generated ADPCM reference without a sibling checkout');
  // Build the real firmware encoder once and decode its bytes here; no duplicate JS encoder can hide a mismatch.
  const firmware=path.resolve(root,'../nrf-controller/src');
  if(!fs.existsSync(path.join(firmware,'adpcm.c')))return;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tag-voice-'));
  try{
    const source=path.join(tmp,'fixture.c'),exe=path.join(tmp,'fixture');
    fs.writeFileSync(source,'#include <stdio.h>\n#include "adpcm.h"\nint main(void){int16_t pcm[800],decoded[800];uint8_t bytes[400];for(int i=0;i<800;i++)pcm[i]=(int16_t)(((i*3571)%50000)-25000);struct adpcm_state e={0},d={0};adpcm_encode(&e,pcm,800,bytes);adpcm_decode(&d,bytes,800,decoded);fwrite(bytes,1,400,stdout);fwrite(decoded,2,800,stdout);return 0;}');
    const build=spawnSync('cc',['-std=c11','-I',firmware,source,path.join(firmware,'adpcm.c'),'-o',exe],{encoding:'utf8'});if(build.status!==0)throw Error(build.stderr);
    const out=spawnSync(exe).stdout,decoded=A.decode(out.subarray(0,400),0,0);check(decoded.every((x,i)=>x===out.readInt16LE(400+i*2)),'the browser decoder matches all 800 samples from the actual C encoder/decoder');
    const wire=fs.readFileSync(path.join(firmware,'audio_wire.h'),'utf8'),dashboard=fs.readFileSync(path.resolve(firmware,'../tools/dashboard/wire.js'),'utf8');
    check(wire.includes('AUDIO_WIRE_VERSION 1')&&Object.values(A.AUDIO).filter(x=>typeof x==='string').every(uuid=>dashboard.includes(uuid))&&A.AUDIO.stick===(1<<(5-1)),'audio UUIDs, version and joystick bit stay aligned with nrf-controller');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
};
