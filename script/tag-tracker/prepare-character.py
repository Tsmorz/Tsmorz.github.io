#!/usr/bin/env python3
"""Offline GLB -> compact teleoperation skin + original PBR textures. No runtime dependencies.
Usage: prepare-character.py source.glb output-dir [simplified-indices.bin]
Run simplify-character.mjs first for the checked-in web LOD. Source/CC0 credit is beside the output.
"""
import json,struct,math,sys
from pathlib import Path
raw=Path(sys.argv[1]).read_bytes();size=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+size]);buf=raw[28+size:]
def accessor(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];n={'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16,'SCALAR':1}[a['type']];f={5126:'f',5123:'H',5125:'I',5121:'B'}[a['componentType']];width=struct.calcsize(f)*n
 return [list(struct.unpack_from('<'+f*n,buf,v.get('byteOffset',0)+a.get('byteOffset',0)+j*v.get('byteStride',width))) for j in range(a['count'])]
def inverse(m):
 a=[[m[c*4+r] for c in range(4)]+[float(r==c) for c in range(4)] for r in range(4)]
 for c in range(4):
  q=max(range(c,4),key=lambda r:abs(a[r][c]));a[c],a[q]=a[q],a[c];k=a[c][c];a[c]=[v/k for v in a[c]]
  for r in range(4):
   if r!=c:
    k=a[r][c];a[r]=[x-k*y for x,y in zip(a[r],a[c])]
 return [a[r][c+4] for c in range(4) for r in range(4)]
def cv(p):return [p[2],p[0],p[1]]
def sub(a,b):return [x-y for x,y in zip(a,b)]
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def unit(a):
 l=math.sqrt(sum(v*v for v in a));return [v/l for v in a]
J=g['skins'][0]['joints'];rest={g['nodes'][i]['name']:cv(inverse(m)[12:15]) for i,m in zip(J,accessor(g['skins'][0]['inverseBindMatrices']))};groups=[]
def group(name,origin,end=None,direction=None):
 t=rest[origin];z=unit(sub(t,rest[end])) if end else unit(direction) if direction else [0,0,1];x=unit(sub([1,0,0],[v*z[0] for v in z]));y=cross(z,x)
 groups.append(dict(name=name,t=t,R=[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]],length=math.dist(t,rest[end]) if end else 1))
group('body','Spine');group('head','Head')
for side,prefix in [('L','Left'),('R','Right')]:
 group('upper'+side,prefix+'Arm',prefix+'ForeArm');group('fore'+side,prefix+'ForeArm',prefix+'Hand');group('hand'+side,prefix+'Hand',direction=sub(rest[prefix+'ForeArm'],rest[prefix+'Hand']))
 group('thigh'+side,prefix+'UpLeg',prefix+'Leg');group('shin'+side,prefix+'Leg',prefix+'Foot');group('foot'+side,prefix+'Foot')
def category(name):
 if name in ['Head','neck','head_end','headfront']:return 'head'
 for prefix,side in [('Left','L'),('Right','R')]:
  if name==prefix+'Arm':return 'upper'+side
  if name==prefix+'ForeArm':return 'fore'+side
  if name==prefix+'Hand':return 'hand'+side
  if name==prefix+'UpLeg':return 'thigh'+side
  if name==prefix+'Leg':return 'shin'+side
  if name in [prefix+'Foot',prefix+'ToeBase']:return 'foot'+side
 return 'body'
lookup={n['name']:i for i,n in enumerate(groups)};parts=[];data=bytearray()
def store(rows,fmt):
 while len(data)%4:data.append(0)
 flat=[v for row in rows for v in row];offset=len(data);data.extend(struct.pack('<'+fmt*len(flat),*flat));return dict(offset=offset,count=len(flat))
p=g['meshes'][0]['primitives'][0];a=p['attributes'];positions=[cv(v) for v in accessor(a['POSITION'])];normals=[cv(v) for v in accessor(a['NORMAL'])];uv=accessor(a['TEXCOORD_0']);ids=accessor(a['JOINTS_0']);weights=accessor(a['WEIGHTS_0']);joints=[];ws=[];fingers=[]
for v,js,ww in zip(positions,ids,weights):
 merged={}
 for j,w in zip(js,ww):
  k=lookup[category(g['nodes'][J[j]]['name'])];merged[k]=merged.get(k,0)+w
 pairs=sorted(merged.items(),key=lambda q:-q[1]);dominant=groups[pairs[0][0]];flag=0
 if dominant['name'].startswith('hand'):
  R=dominant['R'];d=sub(v,dominant['t']);along=sum(R[r*3+2]*d[r] for r in range(3));flag=1 if along<-.025 else 0
 fingers.append([flag]);pairs+=[(0,0)]*(4-len(pairs));joints.append([i for i,w in pairs]);ws.append([w for i,w in pairs])
if len(sys.argv)>3:
 b=Path(sys.argv[3]).read_bytes();indices=struct.unpack('<'+'I'*(len(b)//4),b)
else:indices=[q[0] for q in accessor(p['indices'])]
# Separate the head for the first-person camera. Split/compact to Uint16 WebGL 1 chunks, no index extension needed.
buckets={'Head':[],'Body':[]}
for k in range(0,len(indices),3):
 tri=indices[k:k+3];head=sum(sum(w for j,w in zip(joints[i],ws[i]) if groups[j]['name']=='head') for i in tri)>1.5;buckets['Head' if head else 'Body'].append(tri)
for name,triangles in buckets.items():
 remap={};source=[];idx=[];chunk=0
 def flush():
  if not idx:return
  pick=lambda rows:[rows[i] for i in source]
  parts.append(dict(name=name+str(chunk),material='PBR',color=[1,1,1],pos=store(pick(positions),'f'),normal=store(pick(normals),'f'),uv=store(pick(uv),'f'),joints=store(pick(joints),'B'),weights=store(pick(ws),'f'),fingers=store(pick(fingers),'f'),indices=store([[i] for i in idx],'H')))
 for tri in triangles:
  if len(remap)+sum(i not in remap for i in set(tri))>30000:flush();chunk+=1;remap={};source=[];idx=[]
  for i in tri:
   if i not in remap:remap[i]=len(source);source.append(i)
   idx.append(remap[i])
 flush()
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);textures={}
mat=g['materials'][p['material']]
for name,index in [('base',mat['pbrMetallicRoughness']['baseColorTexture']['index']),('normal',mat['normalTexture']['index']),('roughness',mat['pbrMetallicRoughness']['metallicRoughnessTexture']['index'])]:
 image=g['images'][g['textures'][index]['source']];v=g['bufferViews'][image['bufferView']];file=name+'.jpg';(out/file).write_bytes(buf[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);textures[name]=file
(out/'eli.bin').write_bytes(data);(out/'eli.json').write_text(json.dumps(dict(groups=groups,parts=parts,textures=textures,detailed=True),separators=(',',':'))+'\n')
print('Exported',len(parts),'parts,',sum(p['pos']['count']//3 for p in parts),'vertices,',len(indices)//3,'triangles,',len(data),'bytes + PBR maps')
