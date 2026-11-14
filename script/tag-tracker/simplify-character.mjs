import fs from 'node:fs';
// Offline only: pass the absolute path to meshoptimizer@1.3.0/index.js as argument 4.
import {pathToFileURL} from 'node:url';
const {MeshoptSimplifier}=await import(pathToFileURL(process.argv[4]).href);
await MeshoptSimplifier.ready;
const raw=fs.readFileSync(process.argv[2]),size=raw.readUInt32LE(12),g=JSON.parse(raw.subarray(20,20+size)),buf=raw.subarray(28+size),p=g.meshes[0].primitives[0];
function read(id,T){const a=g.accessors[id],v=g.bufferViews[a.bufferView],n={VEC2:2,VEC3:3,VEC4:4,SCALAR:1,MAT4:16}[a.type],offset=buf.byteOffset+(v.byteOffset||0)+(a.byteOffset||0);const out=new T(a.count*n),stride=v.byteStride||n*T.BYTES_PER_ELEMENT;for(let i=0;i<a.count;i++)out.set(new T(buf.buffer,offset+i*stride,n),i*n);return out;}
const pos=read(p.attributes.POSITION,Float32Array),nrm=read(p.attributes.NORMAL,Float32Array),uv=read(p.attributes.TEXCOORD_0,Float32Array),idx=read(p.indices,Uint32Array),attrs=new Float32Array(pos.length/3*5);
for(let i=0;i<pos.length/3;i++)attrs.set([...nrm.subarray(i*3,i*3+3),...uv.subarray(i*2,i*2+2)],i*5);
const [reduced,error]=MeshoptSimplifier.simplifyWithAttributes(idx,pos,3,attrs,5,[.15,.15,.15,.5,.5],null,180000,.008,['Prune','Permissive','RegularizeLight']);
fs.writeFileSync(process.argv[3],Buffer.from(reduced.buffer));console.log('Reduced',idx.length/3,'to',reduced.length/3,'triangles; normalized error',error);
