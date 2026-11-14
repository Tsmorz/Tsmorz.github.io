// TP/1 controller transport: bounded CRC-checked COBS frames over USB serial; ESB gateways multiplex board IDs.
// Mirrors nrf-controller/src/teleop_wire.{h,c}. IMU/info/actuator payloads keep their existing BLE formats.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ControllerLink=factory();})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const TYPE={HELLO:1,INFO:2,IMU:3,ACT:4,COMMAND:5,ACK:6,PING:7,STATS:8,PLAYBACK:9},MAX=64;
  function crc(a){let c=65535;for(const x of a){c^=x<<8;for(let i=0;i<8;i++)c=(c&32768?(c<<1)^0x1021:c<<1)&65535;}return c;}
  function raw(f){const p=new Uint8Array(f.payload||[]);if(p.length>MAX)throw new Error('Controller payload too large');const a=new Uint8Array(16+p.length),v=new DataView(a.buffer);a.set([84,80,1,f.type]);v.setUint16(4,f.board||0,true);v.setUint16(6,f.seq||0,true);v.setUint32(8,f.stamp||0,true);a[12]=f.pipe||0;a[13]=p.length;a.set(p,14);v.setUint16(a.length-2,crc(a.subarray(0,a.length-2)),true);return a;}
  function decode(a){if(a.length<16||a.length>80||a[0]!==84||a[1]!==80||a[2]!==1||a[13]+16!==a.length||a[12]>7)return null;const v=new DataView(a.buffer,a.byteOffset,a.length);if(v.getUint16(a.length-2,true)!==crc(a.subarray(0,a.length-2)))return null;return {type:a[3],board:v.getUint16(4,true),seq:v.getUint16(6,true),stamp:v.getUint32(8,true),pipe:a[12],payload:a.slice(14,-2)};}
  function frame(f){const a=raw(f),out=[0,0];let code=1,start=1;for(const x of a){if(x===0){out[start]=code;start=out.length;out.push(0);code=1;}else{out.push(x);code++;}}out[start]=code;out.push(0);return new Uint8Array(out);}
  function parser(onFrame){let a=[],discard=false;const stats={bad:0,frames:0};return {stats,push(bytes){for(const x of bytes){if(x){if(a.length>=82){a=[];discard=true;}if(!discard)a.push(x);continue;}if(discard){stats.bad++;discard=false;a=[];continue;}if(!a.length)continue;let out=[],ok=true;for(let i=0;i<a.length;){const n=a[i++];if(!n||i+n-1>a.length){ok=false;break;}for(let j=1;j<n;j++)out.push(a[i++]);if(n<255&&i<a.length)out.push(0);}const f=ok?decode(new Uint8Array(out)):null;a=[];if(f){stats.frames++;onFrame(f);}else stats.bad++;}}};}
  class Serial {
    constructor(port,onFrame,now=()=>performance.now()){this.port=port;this.onFrame=onFrame;this.now=now;this.pending=new Map();this.stamps=new Map();this.seq=Math.floor(Math.random()*65535);this.closed=false;this.parser=parser(f=>this.receive(f));}
    async open(baudRate=1000000){await this.port.open({baudRate,bufferSize:8192});this.writer=this.port.writable.getWriter();this.reader=this.port.readable.getReader();this.reading=this.read();await this.send({type:TYPE.HELLO});}
    async send(f,maxAge=Infinity){if(this.closed||!this.writer)throw new Error('Serial controller disconnected');if(this.writing)throw new Error('Serial link busy');this.writing=true;const at=this.now();try{const bytes=frame(f);await this.writer.ready;if(this.closed)throw new Error('Serial controller disconnected');if(this.now()-at>maxAge)throw new Error('Controller command expired before write');await this.writer.write(bytes);}finally{this.writing=false;}}
    receive(f){
      if(f.type===TYPE.ACT&&f.payload.length===15&&f.payload[0]===2)this.stamps.set(f.board,f.stamp);
      if(f.type===TYPE.ACK&&f.payload.length===3){const v=new DataView(f.payload.buffer),seq=v.getUint16(0,true),key=f.board+':'+seq,p=this.pending.get(key);if(p){clearTimeout(p.timer);this.pending.delete(key);this.rtt=this.now()-p.at;f.payload[2]===0?p.resolve():p.reject(new Error('Controller refused command ('+f.payload[2]+')'));}}
      this.onFrame(f);
    }
    async command(board,pipe,bytes){
      if([...this.pending.values()].some(p=>p.board===board))throw new Error('Controller write busy');
      const stamp=this.stamps.get(board);if(stamp==null)throw new Error('Waiting for fresh controller status');
      const seq=this.seq=(this.seq+1)&65535,key=board+':'+seq;
      return new Promise((resolve,reject)=>{const p={board,resolve,reject,at:this.now(),timer:setTimeout(()=>{this.pending.delete(key);reject(new Error('Controller acknowledgement timed out'));},120)};this.pending.set(key,p);this.send({type:TYPE.COMMAND,board,pipe,seq,stamp,payload:bytes},50).catch(e=>{clearTimeout(p.timer);this.pending.delete(key);reject(e);});});
    }
    async read(){try{while(!this.closed){const {value,done}=await this.reader.read();if(done)break;this.parser.push(value);}}catch(e){if(!this.closed)this.error=e;}finally{this.reader.releaseLock();this.reader=null;this.fail();this.onClose?.(this.error);}}
    fail(){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Serial controller disconnected'));}this.pending.clear();}
    close(){if(!this.closing)this.closing=this.finishClose();return this.closing;}
    async finishClose(){this.fail();try{await this.reader?.cancel();await this.reading;}finally{this.writer?.releaseLock();this.writer=null;await this.port.close();}}
  }
  return {TYPE,MAX,crc,raw,decode,frame,parser,Serial};
});
