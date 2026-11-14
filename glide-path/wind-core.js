// A small diagnostic, mass-consistent terrain wind model. Finite-volume projection of an
// ambient wind onto a Cartesian fluid grid: div(U0 - grad(phi)) = 0, with zero flux into
// terrain and phi=0 at open boundaries. This enforces mass, not momentum or turbulence;
// it cannot establish a separated lee shear layer or predict dynamic-soaring energy.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WindCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function vector(speed,from){const a=from*Math.PI/180;return {east:-Math.sin(a)*speed,north:-Math.cos(a)*speed};}
function bearing(e,n){return ((Math.atan2(-e,-n)*180/Math.PI)%360+360)%360;}
function settings(p={}){return {enabled:p.enabled!==false,height:Number.isFinite(p.height)?clamp(p.height,10,150):30,roughness:[.003,.03,.3].includes(p.roughness)?p.roughness:.03};}
function anchors(data){
 if(!Array.isArray(data)||data.length>16)return [];
 return data.filter(p=>p&&[p.lat,p.lon,p.speed,p.from,p.time].every(Number.isFinite)&&Math.abs(p.lat)<=85.05112878&&Math.abs(p.lon)<=180&&p.speed>=0&&p.speed<=60).map(p=>({lat:p.lat,lon:p.lon,speed:p.speed,from:p.from,time:p.time,gust:Number.isFinite(p.gust)?p.gust:null,
  speed80:Number.isFinite(p.speed80)&&p.speed80>=0&&p.speed80<=80?p.speed80:null,from80:Number.isFinite(p.from80)?p.from80:null}));
}
function inputs(p={}){return {...settings(p),samples:anchors(p.samples)};}
function regional(samples,lat,lon,height=30,z0=.03,fallback={east:0,north:0}){
 if(!samples?.length){const k=Math.log((Math.max(height,0)+z0)/z0)/Math.log((10+z0)/z0);return {east:fallback.east*k,north:fallback.north*k,up:0};}
 let east=0,north=0,sum=0;
 for(const p of samples){
  const d2=((p.lon-lon)*Math.cos(lat*Math.PI/180))**2+(p.lat-lat)**2,w=1/Math.max(1e-10,d2);
  const low=vector(p.speed,p.from);let v;
  if(height>=10&&p.speed80!==null&&p.from80!==null){const high=vector(p.speed80,p.from80),a=clamp(Math.log(height/10)/Math.log(8),0,1);v={east:low.east*(1-a)+high.east*a,north:low.north*(1-a)+high.north*a};}
  else {const a=Math.log((Math.max(0,height)+z0)/z0)/Math.log((10+z0)/z0);v={east:low.east*a,north:low.north*a};}
  east+=v.east*w;north+=v.north*w;sum+=w;
 }
 return {east:east/sum,north:north/sum,up:0};
}
function coordinates(field,e,n){const lat=field.lat+n/111320,lon=field.lon+e/(111320*Math.cos(field.lat*Math.PI/180));return {lat,lon};}
function ambient(field,e,n,height){const p=coordinates(field,e,n);return regional(field.samples,p.lat,p.lon,height,field.roughness,field.fallback);}
function bilinear(a,nx,ny,x,y){
 if(x<0||y<0||x>nx-1||y>ny-1)return NaN;
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*nx+ix;
 const p=a[i],q=fx>1e-10?a[i+1]:p,r=fy>1e-10?a[i+nx]:p,t=fy>1e-10?(fx>1e-10?a[i+nx+1]:r):q;
 return p*(1-fx)*(1-fy)+q*fx*(1-fy)+r*(1-fx)*fy+t*fx*fy;
}
// Field horizontal coordinates are metres east/north of its launch; arrays have southward rows.
function at(field,e,n,height=field?.height??30){
 if(!field)return {east:0,north:0,up:0,mode:'uniform'};
 const base=ambient(field,e,n,height);
 if(!field.east)return {...base,mode:'regional'};
 const x=(e-field.x0)/field.cell-.5,y=(field.y0-n)/field.cell-.5;
 const t=bilinear(field.terrain,field.nx,field.ny,x,y);
 if(!Number.isFinite(t))return {...base,mode:'regional'};
 // Interpolate valid fluid cells vertically within each column, never through solid terrain.
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 let east=0,north=0,up=0,weight=0;
 for(const [dx,dy,w]of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
  if(w<1e-10)continue;const col=(iy+dy)*field.nx+ix+dx;if(col<0||col>=field.nx*field.ny)continue;
  const fz=(field.terrain[col]+height-field.z0)/field.dz-.5;
  const first=field.first[col];if(first>=field.nz)return {...base,mode:'regional'};
  const z=clamp(fz,first,field.nz-1),k=Math.floor(z),kk=Math.min(k+1,field.nz-1),a=z-k,plane=field.nx*field.ny;
  east+=w*(field.east[k*plane+col]*(1-a)+field.east[kk*plane+col]*a);
  north+=w*(field.north[k*plane+col]*(1-a)+field.north[kk*plane+col]*a);
  up+=w*(field.up[k*plane+col]*(1-a)+field.up[kk*plane+col]*a);weight+=w;
 }
 // Blend only the outer two horizontal cells to the regional background.
 const blend=clamp(Math.min(x,y,field.nx-1-x,field.ny-1-y)/2,0,1);
 return weight?{east:base.east*(1-blend)+east/weight*blend,north:base.north*(1-blend)+north/weight*blend,up:up/weight*blend,mode:'terrain'}:{...base,mode:'regional'};
}
function compact(field){ // Fixed layer for positive-loss Dijkstra; no vertical lift credit.
 const N=field.nx*field.ny,east=new Float32Array(N),north=new Float32Array(N),up=new Float32Array(N);
 for(let y=0;y<field.ny;y++)for(let x=0;x<field.nx;x++){const i=y*field.nx+x,v=at(field,field.x0+(x+.5)*field.cell,field.y0-(y+.5)*field.cell,field.height);east[i]=v.east;north[i]=v.north;up[i]=v.up;}
 const radius=Math.max(5000,field.nx*field.cell,...(field.samples||[]).map(p=>Math.max(Math.abs((p.lat-field.lat)*111320),Math.abs((p.lon-field.lon)*111320*Math.cos(field.lat*Math.PI/180)))))*1.2;
 const regionalGrid={nx:33,ny:33,cell:radius/16,x0:-radius-radius/32,y0:radius+radius/32,east:new Float32Array(1089),north:new Float32Array(1089)};
 for(let y=0;y<33;y++)for(let x=0;x<33;x++){const v=ambient(field,-radius+x*radius/16,radius-y*radius/16,field.height);regionalGrid.east[y*33+x]=v.east;regionalGrid.north[y*33+x]=v.north;}
 return {nx:field.nx,ny:field.ny,cell:field.cell,x0:field.x0,y0:field.y0,height:field.height,east,north,up,regionalGrid,lat:field.lat,lon:field.lon,samples:field.samples,roughness:field.roughness,fallback:field.fallback};
}
function sampleLayer(field,e,n){
 if(!field)return null;
 const x=(e-field.x0)/field.cell-.5,y=(field.y0-n)/field.cell-.5;
 const east=bilinear(field.east,field.nx,field.ny,x,y),north=bilinear(field.north,field.nx,field.ny,x,y);
 if(Number.isFinite(east)&&Number.isFinite(north))return {east,north};
 if(field.regionalGrid){const g=field.regionalGrid,x=(e-g.x0)/g.cell-.5,y=(g.y0-n)/g.cell-.5,a=bilinear(g.east,g.nx,g.ny,x,y),b=bilinear(g.north,g.nx,g.ny,x,y);if(Number.isFinite(a)&&Number.isFinite(b))return {east:a,north:b};}
 return ambient(field,e,n,field.height);
}
function solve(o){
 const nx=o.nx,ny=o.ny,N=nx*ny,terrain=Float32Array.from(o.terrain),cell=o.cell;
 const common={...settings(o),nx,ny,cell,x0:o.x0,y0:o.y0,lat:o.lat,lon:o.lon,samples:anchors(o.samples),fallback:o.fallback||{east:0,north:0},terrain};
 if(nx<3||ny<3||!(cell>0)||terrain.length!==N||!terrain.every(Number.isFinite))return {...common,state:'missing',diagnostics:{converged:false}};
 const min=Math.min(...terrain),max=Math.max(...terrain),nz=o.nz||24,z0=min-2,dz=(max-min+Math.max(300,common.height*3))/nz;
 const count=N*nz,fluid=new Uint8Array(count),first=new Uint8Array(N).fill(nz);
 for(let z=0;z<nz;z++)for(let i=0;i<N;i++)if(z0+(z+.5)*dz>terrain[i]){fluid[z*N+i]=1;if(first[i]===nz)first[i]=z;}
 const u=new Float32Array(count),v=new Float32Array(count),w=new Float32Array(count),div=new Float32Array(count),p=new Float32Array(count),diag=new Float32Array(count);
 const ax=1/(cell*cell),az=1/(dz*dz),invCell=1/cell,invDz=1/dz;
 // Cell ambient vectors, then staggered east/south/up faces. Solid faces carry zero flux.
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const i=z*N+y*nx+x;if(!fluid[i])continue;const a=ambient(common,common.x0+(x+.5)*cell,common.y0-(y+.5)*cell,Math.max(.1,z0+(z+.5)*dz-terrain[y*nx+x]));u[i]=a.east;v[i]=-a.north;
 }
 const fx=new Float32Array((nx+1)*ny*nz),fy=new Float32Array(nx*(ny+1)*nz),fz=new Float32Array(N*(nz+1));
 const X=(x,y,z)=>(z*ny+y)*(nx+1)+x,Y=(x,y,z)=>(z*(ny+1)+y)*nx+x;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<=nx;x++){
  const a=x>0?z*N+y*nx+x-1:-1,b=x<nx?z*N+y*nx+x:-1;
  fx[X(x,y,z)]=a<0?(fluid[b]?u[b]:0):b<0?(fluid[a]?u[a]:0):(fluid[a]&&fluid[b]?(u[a]+u[b])/2:0);
 }
 for(let z=0;z<nz;z++)for(let y=0;y<=ny;y++)for(let x=0;x<nx;x++){
  const a=y>0?z*N+(y-1)*nx+x:-1,b=y<ny?z*N+y*nx+x:-1;
  fy[Y(x,y,z)]=a<0?(fluid[b]?v[b]:0):b<0?(fluid[a]?v[a]:0):(fluid[a]&&fluid[b]?(v[a]+v[b])/2:0);
 }
 let initial2=0,active=0;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const i=z*N+y*nx+x;if(!fluid[i])continue;
  const d=(fx[X(x+1,y,z)]-fx[X(x,y,z)]+fy[Y(x,y+1,z)]-fy[Y(x,y,z)])*invCell;
  div[i]=d;initial2+=d*d;active++;
  diag[i]=((x===0||fluid[i-1]?ax:0)+(x===nx-1||fluid[i+1]?ax:0)+(y===0||fluid[i-nx]?ax:0)+(y===ny-1||fluid[i+nx]?ax:0)+(z>0&&fluid[i-N]?az:0)+(z===nz-1||fluid[i+N]?az:0));
 }
 let iterations=0,residual=Infinity;const initial=Math.sqrt(initial2/Math.max(1,active)),tol=Math.max(1e-5,initial*.02),maxIter=o.iterations||500,omega=1.55;
 for(;iterations<maxIter;iterations++){
  for(let colour=0;colour<2;colour++)for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=(colour-y-z)&1;x<nx;x+=2){
   const i=z*N+y*nx+x;if(!fluid[i])continue;let sum=0;
   if(x>0&&fluid[i-1])sum+=ax*p[i-1];if(x<nx-1&&fluid[i+1])sum+=ax*p[i+1];if(y>0&&fluid[i-nx])sum+=ax*p[i-nx];if(y<ny-1&&fluid[i+nx])sum+=ax*p[i+nx];if(z>0&&fluid[i-N])sum+=az*p[i-N];if(z<nz-1&&fluid[i+N])sum+=az*p[i+N];
   p[i]+=omega*((sum-div[i])/diag[i]-p[i]);
  }
  if(iterations%20===0||iterations===maxIter-1){let r2=0;for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const i=z*N+y*nx+x;if(!fluid[i])continue;let lap=-diag[i]*p[i];if(x>0&&fluid[i-1])lap+=ax*p[i-1];if(x<nx-1&&fluid[i+1])lap+=ax*p[i+1];if(y>0&&fluid[i-nx])lap+=ax*p[i-nx];if(y<ny-1&&fluid[i+nx])lap+=ax*p[i+nx];if(z>0&&fluid[i-N])lap+=az*p[i-N];if(z<nz-1&&fluid[i+N])lap+=az*p[i+N];const r=lap-div[i];r2+=r*r;
  }residual=Math.sqrt(r2/Math.max(1,active));if(residual<=tol){iterations++;break;}}
 }
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<=nx;x++){
  const a=x>0?z*N+y*nx+x-1:-1,b=x<nx?z*N+y*nx+x:-1;
  if((a<0||fluid[a])&&(b<0||fluid[b]))fx[X(x,y,z)]-=((b<0?0:p[b])-(a<0?0:p[a]))*invCell;
 }
 for(let z=0;z<nz;z++)for(let y=0;y<=ny;y++)for(let x=0;x<nx;x++){
  const a=y>0?z*N+(y-1)*nx+x:-1,b=y<ny?z*N+y*nx+x:-1;
  if((a<0||fluid[a])&&(b<0||fluid[b]))fy[Y(x,y,z)]-=((b<0?0:p[b])-(a<0?0:p[a]))*invCell;
 }
 for(let z=1;z<=nz;z++)for(let i=0;i<N;i++){
  const a=(z-1)*N+i,b=z<nz?z*N+i:-1;if(fluid[a]&&(b<0||fluid[b]))fz[z*N+i]-=((b<0?0:p[b])-p[a])*invDz;
 }
 let final2=0,maxSpeed=0;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const i=z*N+y*nx+x;if(!fluid[i]){u[i]=v[i]=w[i]=NaN;continue;}
  u[i]=(fx[X(x,y,z)]+fx[X(x+1,y,z)])/2;v[i]=-(fy[Y(x,y,z)]+fy[Y(x,y+1,z)])/2;w[i]=(fz[z*N+y*nx+x]+fz[(z+1)*N+y*nx+x])/2;
  const d=(fx[X(x+1,y,z)]-fx[X(x,y,z)]+fy[Y(x,y+1,z)]-fy[Y(x,y,z)])*invCell+(fz[(z+1)*N+y*nx+x]-fz[z*N+y*nx+x])*invDz;final2+=d*d;maxSpeed=Math.max(maxSpeed,Math.hypot(u[i],v[i],w[i]));
 }
 return {...common,state:'terrain',nz,z0,dz,first,east:u,north:v,up:w,diagnostics:{iterations,initialDivergence:initial,divergence:Math.sqrt(final2/Math.max(1,active)),converged:residual<=tol,maxSpeed}};
}
return {vector,bearing,settings,anchors,inputs,regional,coordinates,ambient,bilinear,solve,at,compact,sampleLayer};
});
