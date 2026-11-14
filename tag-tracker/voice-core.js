// nrf-controller's Bluetooth microphone stream (src/audio_wire.h) and bounded Whisper input. No DOM.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ControllerVoice=factory();})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const AUDIO={service:'6f524c05-0001-4a3c-9d21-1122334455aa',command:'6f524c05-0002-4a3c-9d21-1122334455aa',stream:'6f524c05-0005-4a3c-9d21-1122334455aa',version:1,header:10,rate:16000,maxSeconds:30,stick:16};
  const INDEX=[-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8];
  const STEPS=[7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767];
  const start=id=>Uint8Array.of(1,2,id&255,(id>>8)&255),stop=()=>Uint8Array.of(1,3);
  function chunk(v){
    if(v.byteLength<=AUDIO.header||v.byteLength>4096||v.getUint8(0)!==1||v.getUint8(9)>88)return null;
    return {id:v.getUint16(1,true),first:v.getUint32(3,true),predictor:v.getInt16(7,true),index:v.getUint8(9),bytes:new Uint8Array(v.buffer,v.byteOffset+10,v.byteLength-10)};
  }
  function decode(bytes,predictor,index){
    const samples=new Int16Array(bytes.length*2);
    for(let i=0;i<samples.length;i++){
      const code=(bytes[i>>1]>>(i%2*4))&15,step=STEPS[index];let delta=step>>3;
      if(code&4)delta+=step;if(code&2)delta+=step>>1;if(code&1)delta+=step>>2;
      predictor=Math.max(-32768,Math.min(32767,predictor+(code&8?-delta:delta)));index=Math.max(0,Math.min(88,index+INDEX[code]));samples[i]=predictor;
    }
    return samples;
  }
  class Take {
    constructor(id,rate=16000){if(!Number.isInteger(rate)||rate<8000||rate>48000)throw Error('Unsupported controller microphone rate');this.id=id;this.rate=rate;this.next=0;this.lost=0;this.pieces=[];this.limit=rate*AUDIO.maxSeconds;}
    add(v){
      const c=chunk(v);if(!c||c.id!==this.id||c.first<this.next)return null;
      if(c.first>=this.limit)return null;
      const gap=c.first-this.next;
      // A large timestamp jump is corruption, not permission to allocate arbitrary amounts of silence.
      if(gap>this.rate*2)throw Error('Controller audio was interrupted; try again');
      const pcm=decode(c.bytes,c.predictor,c.index),count=Math.min(pcm.length,this.limit-c.first),out=new Float32Array(gap+count);
      for(let i=0;i<count;i++)out[gap+i]=pcm[i]/32768;
      this.lost+=gap;this.next=c.first+count;this.pieces.push(out);return out;
    }
    get seconds(){return this.next/this.rate;}
    get full(){return this.next>=this.limit;}
    finish(){
      const pcm=new Float32Array(this.next);let at=0;for(const piece of this.pieces){pcm.set(piece,at);at+=piece.length;}
      if(this.rate===16000)return pcm;
      const out=new Float32Array(Math.round(pcm.length*16000/this.rate));
      for(let i=0;i<out.length;i++){const x=i*this.rate/16000,j=Math.min(pcm.length-1,Math.floor(x)),f=x-j;out[i]=j+1<pcm.length?pcm[j]*(1-f)+pcm[j+1]*f:pcm[j];}
      return out;
    }
  }
  return {AUDIO,start,stop,chunk,decode,Take};
});
