#!/usr/bin/env python3
"""Extract a compact, rest-pose skinned mesh from the credited CC0 GLB. Stdlib only; not a site build step."""
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
def cv(p): return [-p[1]*100,p[0]*100,p[2]*100]
def sub(a,b):return [x-y for x,y in zip(a,b)]
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def unit(a):
 l=math.sqrt(sum(v*v for v in a));return [v/l for v in a]
J=g['skins'][0]['joints'];rest={g['nodes'][i]['name']:cv(inverse(m)[12:15]) for i,m in zip(J,accessor(g['skins'][0]['inverseBindMatrices']))}
groups=[]
def group(name,origin,end=None,parent='body'):
 t=rest[origin];z=unit(sub(t,rest[end])) if end else [0,0,1];x=unit(sub([1,0,0],[v*z[0] for v in z]));y=cross(z,x);R=[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]]
 groups.append(dict(name=name,t=t,R=R,length=math.dist(t,rest[end]) if end else 1));return len(groups)-1
group('body','Chest');group('head','Head')
for side in ['L','R']:
 for name,start,end in [('upper','UpperArm','LowerArm'),('fore','LowerArm','Wrist'),('hand','Wrist','Middle2'),('thigh','UpperLeg','LowerLeg'),('shin','LowerLeg','Foot'),('foot','Foot',None)]:
  group(name+side,start+'.'+side,(end+'.'+side) if end else None)
def category(name):
 side=name[-1:] if name.endswith(('.L','.R')) else None
 if name.startswith(('Head','Neck')):return 'head'
 if side:
  if name.startswith('UpperArm'):return 'upper'+side
  if name.startswith('LowerArm'):return 'fore'+side
  if name.startswith(('Wrist','Index','Middle','Ring','Pinky','Thumb')):return 'hand'+side
  if name.startswith('UpperLeg'):return 'thigh'+side
  if name.startswith('LowerLeg'):return 'shin'+side
  if name.startswith('Foot'):return 'foot'+side
 return 'body'
lookup={n['name']:i for i,n in enumerate(groups)}
parts=[];data=bytearray()
def store(values,fmt):
 while len(data)%4:data.append(0)
 offset=len(data);flat=[v for row in values for v in row];data.extend(struct.pack('<'+fmt*len(flat),*flat));return dict(offset=offset,count=len(flat))
for mesh in g['meshes']:
 for p in mesh['primitives']:
  a=p['attributes'];pos=[cv(v) for v in accessor(a['POSITION'])];norm=[[-v[1],v[0],v[2]] for v in accessor(a['NORMAL'])];ids=accessor(a['JOINTS_0']);weights=accessor(a['WEIGHTS_0']);skin=g['skins'][0]['joints']
  joints=[];ws=[];fingers=[]
  for js,ww in zip(ids,weights):
   dominant=g['nodes'][skin[js[max(range(4),key=lambda k:ww[k])]]]['name'];fingers.append([-1 if dominant.startswith('Thumb') else 1 if dominant.startswith(('Index','Middle','Ring','Pinky')) else 0])
   merged={}
   for j,w in zip(js,ww):
    k=lookup[category(g['nodes'][skin[j]]['name'])];merged[k]=merged.get(k,0)+w
   pairs=sorted(merged.items(),key=lambda q:-q[1]);pairs+=[(0,0)]*(4-len(pairs));joints.append([i for i,w in pairs]);ws.append([w for i,w in pairs])
  mat=g['materials'][p['material']];name=mat['name'];color=mat['pbrMetallicRoughness']['baseColorFactor'][:3]
  # Eli wears an everyday blue knit top, charcoal trousers and canvas shoes.
  overrides={'LightBrown':[.055,.13,.20],'LightBlue':[.025,.035,.05],'Red_Dark':[.08,.10,.12]}
  indices=accessor(p['indices'])
  if name=='Hair':
   # Remove the four separate ponytail tufts; keep the scalp and crop the back to a short haircut.
   adjacency={}
   for tri in [indices[i:i+3] for i in range(0,len(indices),3)]:
    ps=[tuple(round(v,5) for v in pos[j[0]]) for j in tri]
    for q in ps:adjacency.setdefault(q,set()).update(ps)
   seen=set();remove=set()
   for q in adjacency:
    if q in seen:continue
    todo=[q];seen.add(q);component=[]
    while todo:
     v=todo.pop();component.append(v)
     for w in adjacency[v]-seen:seen.add(w);todo.append(w)
    if max(v[2] for v in component)<1.70:remove.update(component)
   indices=[j for i in range(0,len(indices),3) if not any(tuple(round(v,5) for v in pos[j[0]]) in remove for j in indices[i:i+3]) for j in indices[i:i+3]]
   for v in pos:v[2]=max(v[2],1.675)
  parts.append(dict(name=mesh['name']+'_'+name,material=name,color=overrides.get(name,color),pos=store(pos,'f'),normal=store(norm,'f'),joints=store(joints,'B'),weights=store(ws,'f'),fingers=store(fingers,'f'),indices=store(indices,'H')))
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);(out/'eli.bin').write_bytes(data);(out/'eli.json').write_text(json.dumps(dict(groups=groups,parts=parts),separators=(',',':'))+'\n')
print('Exported',len(parts),'parts,',sum(p['pos']['count']//3 for p in parts),'vertices,',len(data),'bytes')
