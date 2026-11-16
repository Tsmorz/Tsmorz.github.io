// Numerical initial-guess correspondence only. No force, pose or material state is applied here.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ContactWarmCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function descriptors(values){
    if(!Array.isArray(values))throw Error('Invalid contact warm descriptors.');
    return values.map(value=>{
      const normal=value?.normal,magnitude=normal?.length===3?Math.hypot(...normal):0;
      if(!value||typeof value.kind!=='string'||!value.kind.length||!normal?.every(Number.isFinite)||!(magnitude>0&&Number.isFinite(magnitude))||!Array.isArray(value.parts)||!value.parts.length||value.parts.some(part=>!Number.isInteger(part.panel)||part.panel<0||![1,-1].includes(part.sign)||part.point?.length!==2||!part.point.every(Number.isFinite)))throw Error('Invalid contact warm descriptor.');
      return {value,normal:normal.map(component=>component/magnitude)};
    });
  }
  // Parts are in caller-owned canonical material order. Object identities and
  // material panel/sign separate colliders and layers even at the same world point.
  function match(previous,current,{maxDistance,normalCos=.9}={}){
    if(!(maxDistance>=0&&Number.isFinite(maxDistance))||!(normalCos>=0&&normalCos<=1&&Number.isFinite(normalCos)))throw Error('Invalid contact warm matching distance.');
    const old=descriptors(previous),next=descriptors(current),pairs=[],identities=new Map(),groups=[];
    function group(value,create){
      let map=identities;
      const keys=[value.kind,value.body,value.jaw,value.shape,value.parts.length,...value.parts.flatMap(part=>[part.panel,part.sign])];
      for(const key of keys){if(!map.has(key)){if(!create)return null;map.set(key,new Map());}map=map.get(key);}
      if(!map.has('records')){if(!create)return null;const out={ids:[]};map.set('records',out);groups.push(out);}return map.get('records');
    }
    old.forEach(({value},i)=>group(value,true).ids.push(i));
    const cellKey=(x,y)=>x+':'+y;
    for(const g of groups){
      // Extreme SI coordinates use the original scan. Within this bound two
      // guard cells also cover subtraction/division rounding at cell edges.
      if(maxDistance>0&&!g.ids.every(i=>old[i].value.parts[0].point.every(v=>Number.isFinite(v/maxDistance)&&Math.abs(v/maxDistance)<2**50)))continue;
      g.cells=new Map();for(const i of g.ids){const [x,y]=old[i].value.parts[0].point,key=maxDistance>0?cellKey(Math.floor(x/maxDistance),Math.floor(y/maxDistance)):cellKey(x,y);if(!g.cells.has(key))g.cells.set(key,[]);g.cells.get(key).push(i);}
    }
    for(let j=0;j<next.length;j++){
      const b=next[j].value,g=group(b,false);if(!g)continue;
      const [x,y]=b.parts[0].point;
      let candidates=g.ids;
      if(g.cells&&maxDistance===0)candidates=g.cells.get(cellKey(x,y))||[];
      else if(g.cells&&[x,y].every(v=>Number.isFinite(v/maxDistance)&&Math.abs(v/maxDistance)<2**50)){
        candidates=[];const cx=Math.floor(x/maxDistance),cy=Math.floor(y/maxDistance);
        for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const ids=g.cells.get(cellKey(cx+dx,cy+dy));if(ids)candidates.push(...ids);}
      }
      for(const i of candidates){
        const a=old[i].value,b=next[j].value;
        if(a.kind!==b.kind||a.body!==b.body||a.jaw!==b.jaw||a.shape!==b.shape||a.parts.length!==b.parts.length)continue;
        const cosine=old[i].normal.reduce((sum,value,axis)=>sum+value*next[j].normal[axis],0);if(!(cosine>0&&cosine>=normalCos))continue;
        let distance=0,eligible=true;
        for(let k=0;k<a.parts.length;k++){
          const p=a.parts[k],q=b.parts[k];if(p.panel!==q.panel||p.sign!==q.sign){eligible=false;break;}
          const d=Math.hypot(p.point[0]-q.point[0],p.point[1]-q.point[1]);if(d>maxDistance){eligible=false;break;}
          // sqrt(sum(distance²)) has the same ordering, without squaring SI points.
          distance=Math.hypot(distance,d);
        }
        if(eligible)pairs.push({old:i,next:j,distance});
      }
    }
    pairs.sort((a,b)=>a.distance-b.distance||a.old-b.old||a.next-b.next);
    const result=Array(next.length).fill(-1),used=new Set();
    for(const pair of pairs)if(result[pair.next]<0&&!used.has(pair.old)){result[pair.next]=pair.old;used.add(pair.old);}
    return result;
  }
  return {match};
});
