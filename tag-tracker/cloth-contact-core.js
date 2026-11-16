// Finite cloth-triangle contacts against an oriented box; world metres throughout.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ClothContactCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const EPS=1e-12,add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],length=v=>Math.hypot(v[0],v[1],v[2]),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],distance2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
  const mv=(R,p)=>[R[0]*p[0]+R[1]*p[1]+R[2]*p[2],R[3]*p[0]+R[4]*p[1]+R[5]*p[2],R[6]*p[0]+R[7]*p[1]+R[8]*p[2]],mt=(R,p)=>[R[0]*p[0]+R[3]*p[1]+R[6]*p[2],R[1]*p[0]+R[4]*p[1]+R[7]*p[2],R[2]*p[0]+R[5]*p[1]+R[8]*p[2]];
  const axes=[[1,0,0],[0,1,0],[0,0,1]],weights=[[1,0,0],[0,1,0],[0,0,1]],edges=[[0,1],[1,2],[2,0]];
  const boxEdgeIds=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  function closestSegment(p,a,b){const d=sub(b,a),den=dot(d,d),t=den>1e-24?clamp(dot(sub(p,a),d)/den,0,1):0;return {point:mix(a,b,t),t};}
  function closestTriangle(p,a,b,c){
    const ab=sub(b,a),ac=sub(c,a);
    const n=cross(ab,ac);if(dot(n,n)<1e-24){
      let best=null;for(const [i,j]of edges){const v=[a,b,c],q=closestSegment(p,v[i],v[j]),distance=length(sub(p,q.point));if(!best||distance<best.distance)best={point:q.point,w:mix(weights[i],weights[j],q.t),distance};}return best;
    }
    const ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return {point:a,w:weights[0]};
    const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return {point:b,w:weights[1]};
    const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const t=d1/(d1-d3);return {point:mix(a,b,t),w:[1-t,t,0]};}
    const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return {point:c,w:weights[2]};
    const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const t=d2/(d2-d6);return {point:mix(a,c,t),w:[1-t,0,t]};}
    const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const t=(d4-d3)/((d4-d3)+(d5-d6));return {point:mix(b,c,t),w:[0,1-t,t]};}
    const den=va+vb+vc,v=vb/den,w=vc/den;return {point:add(a,add(scale(ab,v),scale(ac,w))),w:[1-v-w,v,w]};
  }
  function closestEdges(a,b,c,d){
    const u=sub(b,a),v=sub(d,c),r=sub(a,c),A=dot(u,u),E=dot(v,v),F=dot(v,r);let s=0,t=0;
    if(A<=1e-24&&E<=1e-24)return {point:a,other:c,s,t};
    if(A<=1e-24)t=clamp(F/E,0,1);
    else{const C=dot(u,r);if(E<=1e-24)s=clamp(-C/A,0,1);else{const B=dot(u,v),den=A*E-B*B;s=den>A*E*1e-14?clamp((B*F-C*E)/den,0,1):0;t=(B*s+F)/E;if(t<0){t=0;s=clamp(-C/A,0,1);}else if(t>1){t=1;s=clamp((B-C)/A,0,1);}}}
    return {point:mix(a,b,s),other:mix(c,d,t),s,t};
  }
  // True finite-triangle closest feature. featureTolerance is a WORLD distance,
  // never a barycentric margin: optional snapping stays on the actual mesh and
  // reports its displacement/error. Zero preserves exact face interiors.
  function pointTriangle(point,points,{ids=[0,1,2],featureTolerance=0}={}){
    const valid=v=>v?.length===3&&Array.from(v).every(Number.isFinite);
    if(!valid(point)||points?.length!==3||!Array.from(points).every(valid)||ids?.length!==3||!Array.from(ids).every(v=>Number.isInteger(v)&&v>=0)||new Set(ids).size!==3||!(featureTolerance>=0&&Number.isFinite(featureTolerance)))throw Error('Invalid point/triangle feature geometry.');
    const [a,b,c]=points,ab=sub(b,a),ac=sub(c,a),areaVector=cross(ab,ac),area=length(areaVector),den=dot(areaVector,areaVector),faceNormal=area>0?scale(areaVector,1/area):[0,0,0],planeDistance=dot(sub(point,a),faceNormal),projection=sub(point,scale(faceNormal,planeDistance));
    if(!Number.isFinite(area)||area>0&&!(den>0&&Number.isFinite(den))||!Number.isFinite(planeDistance)||!projection.every(Number.isFinite))throw Error('Unresolved point/triangle geometry scale.');
    let projectedW=null;if(area>0){const ap=sub(point,a),y=dot(cross(ap,ac),areaVector)/den,z=dot(cross(ab,ap),areaVector)/den;projectedW=[1-y-z,y,z];if(!projectedW.every(Number.isFinite))throw Error('Unresolved point/triangle projection.');}
    const feature=(type,indices)=>({type,ids:indices.map(i=>ids[i]).sort((x,y)=>x-y)}),at=(q,w,f)=>({point:q,w,feature:f,distance:length(sub(point,q))}),vertices=points.map((q,i)=>at(Array.from(q),weights[i].slice(),feature('vertex',[i]))),segments=edges.map(([i,j])=>{
      // Shared edges use the same endpoint order in every incident triangle.
      if(ids[i]>ids[j])[i,j]=[j,i];const d=sub(points[j],points[i]),L=length(d),t=L>0?clamp(dot(sub(point,points[i]),scale(d,1/L))/L,0,1):0,w=[0,0,0];w[i]=1-t;w[j]=t;
      return t===0?vertices[i]:t===1?vertices[j]:at(mix(points[i],points[j],t),w,feature('edge',[i,j]));
    });
    let raw;
    if(projectedW&&projectedW.every(v=>v>0))raw=at([0,1,2].map(k=>projectedW.reduce((sum,w,i)=>sum+w*points[i][k],0)),projectedW.slice(),feature('face',[0,1,2]));
    else{
      // Compare in-plane distance, so a large normal separation cannot round
      // two different nearby material features into an accidental equal tie.
      const candidates=segments.concat(vertices);raw=candidates[0];for(const q of candidates)if(distance2(q.point,projection)<distance2(raw.point,projection)||distance2(q.point,projection)===distance2(raw.point,projection)&&q.feature.ids.join(':')<raw.feature.ids.join(':'))raw=q;
    }
    let chosen=raw;
    if(featureTolerance>0){
      const eligible=candidates=>candidates.filter(q=>length(sub(q.point,raw.point))<=featureTolerance&&q.distance<=raw.distance+featureTolerance).sort((x,y)=>length(sub(x.point,raw.point))-length(sub(y.point,raw.point))||x.feature.ids.join(':').localeCompare(y.feature.ids.join(':')));
      const nearVertex=eligible(vertices),nearEdge=eligible(segments.filter(q=>q.feature.type==='edge'));chosen=nearVertex[0]||nearEdge[0]||raw;
    }
    const delta=sub(point,chosen.point),distance=length(delta),snapDisplacement=sub(chosen.point,raw.point),snapDistance=length(snapDisplacement),distanceError=Math.max(0,distance-raw.distance),normal=distance>0?scale(delta,1/distance):faceNormal.slice();
    if(!Number.isFinite(distance)||!normal.every(Number.isFinite)||!chosen.w.every(Number.isFinite))throw Error('Unresolved point/triangle closest feature.');
    return {point:chosen.point.slice(),w:chosen.w.slice(),normal,distance,faceNormal,planeDistance,projectedW:projectedW?.slice()||null,feature:{...chosen.feature,ids:chosen.feature.ids.slice()},snapDisplacement,snapDistance,distanceError,errorBound:snapDistance,snapped:snapDistance>0};
  }
  function closestSegments(a,b,c,d){
    if([a,b,c,d].some(v=>v?.length!==3||!Array.from(v).every(Number.isFinite)))throw Error('Invalid segment feature geometry.');
    const q=closestEdges(a,b,c,d);if(![...q.point,...q.other,q.s,q.t].every(Number.isFinite))throw Error('Unresolved segment geometry scale.');return {...q,point:q.point.slice(),other:q.other.slice()};
  }
  function clip(polygon,axis,sign,h){
    const out=[];for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*a.p[axis]-h,db=sign*b.p[axis]-h,insideA=da<=EPS,insideB=db<=EPS;
      if(insideA)out.push(a);if(insideA!==insideB){const t=da/(da-db);out.push({p:mix(a.p,b.p,t),w:mix(a.w,b.w,t)});}
    }return out;
  }
  // ids identify material vertices, not panel-local indices. A caller can share
  // seen per physical box/projection pass to avoid duplicate shared-edge samples.
  function triangleBox(points,box,radius=0,{ids,seen,maxContacts=4}={}){
    const p=points.map(v=>mt(box.R,sub(v,box.t))),h=box.h;
    if(p.some(v=>v.some(x=>!Number.isFinite(x)))||h.some(v=>!(v>0))||!(radius>=0&&Number.isFinite(radius)))throw Error('Invalid triangle/box contact geometry.');
    const low=[0,1,2].map(i=>Math.min(p[0][i],p[1][i],p[2][i])),high=[0,1,2].map(i=>Math.max(p[0][i],p[1][i],p[2][i]));
    for(let i=0;i<3;i++)if(low[i]>h[i]+radius+EPS||high[i]< -h[i]-radius-EPS)return [];
    const candidates=[];let intersects=!low.some((v,i)=>v>h[i]+EPS||high[i]< -h[i]-EPS),best=Infinity,normal=[0,0,1];
    // A box-face separation already proves no solid intersection. In this
    // common thin-cloth case the closest footprint below is exact; building
    // triangle-edge SAT axes first only repeats that conclusion.
    if(intersects){
      const allAxes=axes.slice(),triEdges=edges.map(([a,b])=>sub(p[b],p[a]));
      const appendAxis=axis=>{const n=length(axis);if(n<1e-14)return;const unit=scale(axis,1/n);if(!allAxes.some(a=>Math.abs(dot(a,unit))>1-1e-10))allAxes.push(unit);};
      appendAxis(cross(triEdges[0],sub(p[2],p[0])));for(const edge of triEdges)for(const axis of axes)appendAxis(cross(edge,axis));
      for(const axis of allAxes){
      const lo=Math.min(...p.map(v=>dot(v,axis))),hi=Math.max(...p.map(v=>dot(v,axis))),extent=dot(h,axis.map(Math.abs));
      if(lo>extent+EPS||hi< -extent-EPS){intersects=false;break;}
      const plus=extent-lo,minus=extent+hi,value=Math.min(plus,minus);
      if(value<best-EPS){best=value;normal=plus<minus?axis:scale(axis,-1);}
      }
    }
    const key=(w,point)=>ids?w.flatMap((v,i)=>v>1e-8?[[ids[i],Math.round(v*1e9)]]:[]).sort((a,b)=>a[0]-b[0]).map(v=>v.join(':')).join('|'):point.map(v=>Math.round(v*1e9)).join(':');
    const put=(point,w,n,depth)=>{
      if(depth< -EPS||candidates.some(c=>distance2(c.local,point)<1e-20))return;
      const signature=key(w,point);if(seen?.has(signature))return;
      candidates.push({local:point,w:w.slice(),normal:n,depth:Math.max(0,depth),key:signature});
    };
    if(intersects){
      let polygon=p.map((v,i)=>({p:v,w:weights[i]}));for(let i=0;i<3&&polygon.length;i++)for(const sign of [-1,1])polygon=clip(polygon,i,sign,h[i]);
      const extent=dot(h,normal.map(Math.abs));for(const v of polygon)put(v.p,v.w,normal,extent+radius-dot(normal,v.p));
    }else if(radius>0){
      // A face-separated triangle with a footprint on the box needs only four
      // lateral clips, even when tilted. Most tabletop/toe contacts take this
      // path; rounded edge/corner-only cases use the exact feature search below.
      let faceFound=false;
      for(let axis=0;axis<3&&!faceFound;axis++){
        const sign=low[axis]>h[axis]+EPS?1:high[axis]< -h[axis]-EPS?-1:0;if(!sign)continue;
        let polygon=p.map((v,i)=>({p:v,w:weights[i]}));for(let k=0;k<3;k++)if(k!==axis)for(const side of [-1,1])polygon=clip(polygon,k,side,h[k]);
        polygon=clip(polygon,axis,sign,h[axis]+radius);
        if(polygon.length){const n=scale(axes[axis],sign);for(const v of polygon)put(v.p,v.w,n,h[axis]+radius-sign*v.p[axis]);faceFound=true;}
      }
      if(!faceFound){
      // Exact polytope closest features avoid the false rounded-corner contacts
      // produced by merely expanding all three box extents by the cloth radius.
      const closest=(point,w)=>{const nearest=point.map((v,i)=>clamp(v,-h[i],h[i])),delta=sub(point,nearest),distance=length(delta);if(distance<=radius+EPS&&distance>EPS)put(point,w,scale(delta,1/distance),radius-distance);};
      p.forEach((v,i)=>closest(v,weights[i]));
      const vertices=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push([x*h[0],y*h[1],z*h[2]]);
      for(const v of vertices){const q=closestTriangle(v,...p);closest(q.point,q.w,v);}
      for(const [i,j]of edges)for(const [a,b]of boxEdgeIds){const q=closestEdges(p[i],p[j],vertices[a],vertices[b]);closest(q.point,mix(weights[i],weights[j],q.s));}
      }
    }
    const out=[],limit=Math.max(1,Math.min(8,Math.floor(maxContacts)||4));
    while(candidates.length&&out.length<limit){
      let at=0,score=-Infinity;
      candidates.forEach((c,i)=>{const value=out.length?Math.min(...out.map(q=>distance2(c.local,q.local))):c.depth;if(value>score+(out.length?1e-18:EPS)){score=value;at=i;}});
      const [contact]=candidates.splice(at,1);out.push(contact);seen?.add(contact.key);
    }
    return out.map(c=>({w:c.w,point:points[0].map((_,k)=>c.w.reduce((s,v,i)=>s+v*points[i][k],0)),normal:mv(box.R,c.normal),depth:c.depth,key:c.key}));
  }
  // Reachable poses discover finite material features only. Their penetration
  // must never become the current gap: unloading a compressed face can reach a
  // still-separated sheet. Every appended row uses the current closest feature.
  // Work/output are bounded per unique pose by triangleBox's manifold limit.
  function triangleBoxCandidates(points,currentBox,reachableBoxes=[],radius=0,{ids,seen,maxContacts=4}={}){
    if(!Array.isArray(reachableBoxes))throw Error('Reachable boxes must be an array.');
    const current=triangleBox(points,currentBox,radius,{ids,maxContacts}),out=[],accepted=new Set(),poses=new Set();
    const key=(w,point)=>ids?w.flatMap((v,i)=>v>1e-8?[[ids[i],Math.round(v*1e9)]]:[]).sort((a,b)=>a[0]-b[0]).map(v=>v.join(':')).join('|'):mt(currentBox.R,sub(point,currentBox.t)).map(v=>Math.round(v*1e9)).join(':');
    const put=contact=>{const signature=key(contact.w,contact.point);if(accepted.has(signature)||seen?.has(signature))return;accepted.add(signature);out.push({...contact,key:signature,gap:-contact.depth});};
    current.forEach(put);
    const poseKey=box=>[...box.R,...box.t,...box.h].join(',');poses.add(poseKey(currentBox));
    for(const box of reachableBoxes){
      const pose=poseKey(box);if(poses.has(pose))continue;poses.add(pose);
      for(const candidate of triangleBox(points,box,radius,{ids,maxContacts})){
        if(accepted.has(key(candidate.w,candidate.point)))continue;
        const p=mt(currentBox.R,sub(candidate.point,currentBox.t)),q=p.map((v,i)=>clamp(v,-currentBox.h[i],currentBox.h[i])),delta=sub(p,q),distance=length(delta);
        if(distance>EPS)put({...candidate,normal:mv(currentBox.R,scale(delta,1/distance)),depth:radius-distance});
        else if(!current.length){
          // Degenerate/tangent roundoff can leave an exact boundary sample
          // without a current manifold; retain its actual signed box distance.
          let axis=0;for(let i=1;i<3;i++)if(currentBox.h[i]-Math.abs(p[i])<currentBox.h[axis]-Math.abs(p[axis]))axis=i;
          const n=[0,0,0];n[axis]=p[axis]>=0?1:-1;put({...candidate,normal:mv(currentBox.R,n),depth:radius+currentBox.h[axis]-Math.abs(p[axis])});
        }
        // Existing solid intersections keep their current finite manifold,
        // rather than adding different normals from an unloaded clipping edge.
      }
    }
    for(const contact of out)seen?.add(contact.key);
    return out;
  }
  return {triangleBox,triangleBoxCandidates,pointTriangle,closestSegments};
});
