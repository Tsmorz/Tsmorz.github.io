// Regional forecast input, terrain wind worker and map layer. Horizontal flow alone feeds reach.
windUI = (()=>{
 'use strict';
 const W=WindCore,arrowLayer=L.layerGroup().addTo(map);
 let config=W.inputs(sharedPlan?.windModel||LS.get('wind-model',{})),meta=LS.get('weather',null),field=null,layer=null,revision=0,applied='',wanted='',busy=false,queued=null,pendingKey='';
 if(config.samples.length)meta=config.samples[0];
 let windWorker=null,controller=null,request=0,error='',shade=null;
 const cv=document.createElement('canvas');cv.width=cv.height=56;
 try{windWorker=new Worker('wind-worker.js');windWorker.onmessage=e=>receive(e.data);windWorker.onerror=()=>{windWorker?.terminate();windWorker=null;busy=false;pendingKey='';applied='';wanted='';$('flowStatus').textContent='Wind worker unavailable. Using regional wind; retry to estimate terrain flow.';config.enabled=false;layer=null;field=null;settingsUI();revision++;compute();};}catch{}
 function activeSamples(){
  if(!config.samples.length)return [];
  if(launch){const ys=config.samples.map(p=>p.lat),xs=config.samples.map(p=>p.lon),pad=.03;if(launch.lat<Math.min(...ys)-pad||launch.lat>Math.max(...ys)+pad||launch.lng<Math.min(...xs)-pad||launch.lng>Math.max(...xs)+pad)return [];}
  return config.samples;
 }
 function key(){return launch&&M?[launch.lat,launch.lng,P.ws,P.wd,P.vis,soaringUI?.terrainData?.id,config.height,config.roughness,config.enabled,JSON.stringify(activeSamples())].join():'';}
 function settingsUI(){
  $('terrainWind').checked=config.enabled;$('windHeight').value=+(config.height*(units==='imperial'?G.FT:1)).toFixed(2);$('windHeight').min=10*(units==='imperial'?G.FT:1);$('windHeight').max=150*(units==='imperial'?G.FT:1);$('windHeightUnit').textContent=units==='imperial'?'ft AGL':'m AGL';$('roughness').value=config.roughness;$('windHeight').disabled=$('roughness').disabled=!config.enabled;
 }
 function parameters(){
  // Editing mean wind makes it a manual scenario; it must not secretly retain forecast neighbours.
  if(meta&&(Math.abs(meta.speed-P.ws)>1e-8||Math.abs(meta.from-P.wd)>1e-8))config.samples=[];
  settingsUI();label();if(applied===key())render();if(applied&&applied!==key()){arrowLayer.clearLayers();if(shade)shade.remove();$('flowStatus').textContent=CONTENT.flow.updating;}
 }
 function prepare(){
  if(!launch||!M)return true;
  if(!config.enabled){if(layer){layer=null;field=null;revision++;arrowLayer.clearLayers();if(shade)shade.remove();}applied=key();$('flowStatus').textContent=CONTENT.flow.disabled;return true;}
  wanted=key();if(applied===wanted)return true;if(pendingKey===wanted)return false;
  const source=soaringUI?.terrainData;if(!source){soaringUI?.ensureTerrain();return false;}
  const [atX,atY]=G.lonLatToPx(launch.lng,launch.lat,source.z),sx=(atX-source.x0)/2,sy=(atY-source.y0)/2;
  if(sx<0||sy<0||sx>=source.W||sy>=source.W){soaringUI?.ensureTerrain();return false;}
  const nx=56,ny=56,radius=Math.max(800,P.vis*1.35),cell=radius*2/nx,terrain=new Float32Array(nx*ny),[px,py]=G.lonLatToPx(launch.lng,launch.lat,source.z);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const e=-radius+(x+.5)*cell,n=radius-(y+.5)*cell;terrain[y*nx+x]=SoaringCore.sample(source.terr,source.W,source.W,(px+e/(source.cell/2)-source.x0-1)/2,(py-n/(source.cell/2)-source.y0-1)/2);}
  const job={key:wanted,options:{...config,samples:activeSamples(),lat:launch.lat,lon:launch.lng,nx,ny,cell,x0:-radius,y0:radius,terrain,fallback:W.vector(P.ws,P.wd)}};
  pendingKey=wanted;$('flowStatus').textContent=CONTENT.flow.updating;
  if(busy)queued=job;else send(job);return false;
 }
 function send(job){busy=true;if(windWorker)windWorker.postMessage(job);else setTimeout(()=>{try{const f=W.solve(job.options);receive({key:job.key,field:f,layer:W.compact(f)});}catch(e){receive({key:job.key,error:e.message});}},0);}
 function receive(message){
  busy=false;
  if(message.key===key()){
   pendingKey='';applied=message.key;
   if(message.error){field=null;layer=null;$('flowStatus').textContent=message.error;}
   else{field=message.field;layer=message.layer;const d=field.diagnostics;
    $('flowStatus').textContent=field.state==='terrain'?`${CONTENT.flow.ready} ${U.h(field.cell)} grid · ${U.h(field.dz)} vertical · ${U.h(config.height)} AGL${d.converged?'':'. Solve not converged; estimates uncertain.'}`:CONTENT.flow.missing;
   }
   revision++;render();windBadge();compute();soaringUI?.run();
  }
  if(queued){const job=queued;queued=null;if(job.key===key())send(job);}
 }
 function sample(e,n,h=config.height){
  if(!config.enabled)return {...W.vector(P.ws,P.wd),up:0,mode:'uniform'};
  if(field&&applied===key())return W.at(field,e,n,h);
  const p={lat:launch.lat+n/111320,lon:launch.lng+e/(111320*Math.cos(launch.lat*Math.PI/180))};return {...W.regional(activeSamples(),p.lat,p.lon,h,config.roughness,W.vector(P.ws,P.wd)),mode:'regional'};
 }
 function atLatLng(point,height=config.height){const e=(point.lng-launch.lng)*111320*Math.cos(launch.lat*Math.PI/180),n=(point.lat-launch.lat)*111320;return sample(e,n,height);}
 let windLines=[];
 function render(){
  windLines=[];arrowLayer.clearLayers();if(shade)shade.remove();if(!layer||applied!==key()||!config.enabled)return;
  const toLL=(e,n)=>L.latLng(launch.lat+n/111320,launch.lng+e/(111320*Math.cos(launch.lat*Math.PI/180)));
  if($('windArrows').checked)for(let y=8;y<layer.ny;y+=12)for(let x=8;x<layer.nx;x+=12){
   const e=layer.x0+(x+.5)*layer.cell,n=layer.y0-(y+.5)*layer.cell,v=W.sampleLayer(layer,e,n),speed=Math.hypot(v.east,v.north);if(speed<.1)continue;
   const len=55/speed,tip=toLL(e+v.east*len,n+v.north*len),tail=toLL(e-v.east*len*.3,n-v.north*len*.3);windLines.push([tail,tip],[toLL(e+v.east*len*.65-v.north*len*.22,n+v.north*len*.65+v.east*len*.22),tip,toLL(e+v.east*len*.65+v.north*len*.22,n+v.north*len*.65-v.east*len*.22)]);
   const a=Math.atan2(v.east,v.north)*180/Math.PI;
   L.marker(toLL(e,n),{interactive:false,icon:L.divIcon({className:'wind-vector',html:`<svg viewBox="-12 -12 24 24" style="transform:rotate(${a}deg)" aria-hidden="true"><path class="wind-casing" d="M0 9V-8M-4 -4 0 -8 4 -4"/><path d="M0 9V-8M-4 -4 0 -8 4 -4"/></svg>`,iconSize:[24,24],iconAnchor:[12,12]}),title:`${U.v(speed)} toward ${compass((a+360)%360)} at ${U.h(config.height)} AGL`}).addTo(arrowLayer);
  }
  if($('ridgeShading').checked&&field?.state==='terrain'){
   cv.width=layer.nx;cv.height=layer.ny;const ctx=cv.getContext('2d'),img=ctx.createImageData(cv.width,cv.height);
   for(let i=0;i<layer.up.length;i++){const v=layer.up[i],k=i*4;if(Math.abs(v)<.05)continue;const up=v>0;img.data[k]=up?18:184;img.data[k+1]=up?165:38;img.data[k+2]=up?153:58;img.data[k+3]=Math.min(130,Math.abs(v)*65)*(up||((i%layer.nx+Math.floor(i/layer.nx))%4<2)?1:.35);}
   ctx.putImageData(img,0,0);const bounds=L.latLngBounds(toLL(layer.x0,layer.y0-layer.ny*layer.cell),toLL(layer.x0+layer.nx*layer.cell,layer.y0));shade=new CanvasOverlay(cv,bounds,{interactive:false,opacity:.65}).addTo(map);
  }
  mark3d();
 }
 function label(){
  const el=$('windSource');if(error){el.textContent=error;return;}
  if(!activeSamples().length){el.textContent=config.samples.length?'Forecast is from the earlier area. Reference wind retained; refresh for this launch.':CONTENT.weather.manual;return;}
  const samples=activeSamples(),time=Math.min(...samples.map(p=>p.time)),old=Date.now()-time>90*60000;
  const independent=new Set(samples.map(p=>`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)).size;
  el.textContent=`Open-Meteo · ${independent} model grid point${independent===1?'':'s'} · 10${samples.some(p=>p.speed80!==null)?' / 80':''} m · ${new Date(time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})}. ${old?'Outdated snapshot; refresh before use.':'Regional forecast applied.'}`;
 }
 async function fetchWind(){
  if(!launch||!navigator.onLine){error='Wind needs a connection. The existing plan is unchanged.';label();return;}
  controller?.abort();const seq=++request,point={lat:launch.lat,lon:launch.lng},before=[P.ws,P.wd].join(),radius=Math.max(3000,(M?.W||0)*(M?.mpp||0)/2),points=[];
  // Centre first, then surrounding grid: vectors are interpolated, never compass angles.
  points.push(point);for(const y of [-1,0,1])for(const x of [-1,0,1])if(x||y)points.push({lat:point.lat+y*radius/111320,lon:point.lon+x*radius/(111320*Math.cos(point.lat*Math.PI/180))});
  controller=new AbortController();const c=controller,timer=setTimeout(()=>c.abort(),15000);$('fetchWind').disabled=true;error=CONTENT.weather.loading;label();
  try{
   const url=new URL(SoaringCore.windURL(point.lat,point.lon));url.searchParams.set('latitude',points.map(p=>p.lat.toFixed(6)).join(','));url.searchParams.set('longitude',points.map(p=>p.lon.toFixed(6)).join(','));url.searchParams.set('current','wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m');
   const res=await fetch(url,{signal:c.signal,cache:'no-store'});if(!res.ok)throw Error(`Wind service unavailable (${res.status}). Plan unchanged.`);
   const body=await res.json(),data=Array.isArray(body)?body:[body];if(!data.length||data.length>points.length)throw Error('Incomplete regional forecast. Plan unchanged.');
   const values=data.map((d,i)=>({...SoaringCore.parseWind(d),lat:Number.isFinite(d.latitude)?d.latitude:points[i].lat,lon:Number.isFinite(d.longitude)?d.longitude:points[i].lon}));
   if(seq!==request)return;if(point.lat!==launch.lat||point.lon!==launch.lng||before!==[P.ws,P.wd].join())throw Error('Launch or wind changed while loading. Refresh for the current plan.');
   const first=values[0],speed=GP.inputValue('ws',first.speed,'metric');Object.assign(P,{ws:speed,wd:first.from});config.samples=W.anchors(values);meta={...first,...point,samples:config.samples};LS.set('weather',meta);LS.set('wind-model',snapshot());error='';save();setSliders();wdDial.render();parameterChanged();label();
  }catch(e){if(seq===request){error=e.name==='AbortError'?'Wind request timed out. Plan unchanged.':e.message;label();}}
  finally{clearTimeout(timer);if(seq===request){controller=null;$('fetchWind').disabled=false;}}
 }
 function snapshot(){return W.inputs(config);}
 function restore(value){request++;controller?.abort();controller=null;$('fetchWind').disabled=false;config=W.inputs(value);meta=config.samples[0]?{...config.samples[0],samples:config.samples}:null;applied='';error='';settingsUI();label();LS.set('wind-model',snapshot());}
 function changed(){config.enabled=$('terrainWind').checked;const h=Number($('windHeight').value)/(units==='imperial'?G.FT:1);if(!Number.isFinite(h)||h<9.99||h>150.01){settingsUI();return;}config.height=h;config.roughness=W.settings({roughness:Number($('roughness').value)}).roughness;LS.set('wind-model',snapshot());applied='';afterParams();markCalc('updating');schedule('all');}
 $('terrainWind').onchange=changed;$('windHeight').onchange=changed;$('roughness').onchange=changed;
 $('windArrows').checked=LS.get('wind-arrows',true)!==false;$('ridgeShading').checked=LS.get('wind-shading',false)===true;
 $('windArrows').onchange=()=>{LS.set('wind-arrows',$('windArrows').checked);render();};$('ridgeShading').onchange=()=>{LS.set('wind-shading',$('ridgeShading').checked);render();};
 ['ws','n_ws','windBearing'].forEach(id=>$(id).addEventListener('input',()=>{error='';label();}));
 $('fetchWind').onclick=fetchWind;settingsUI();label();
 return {features:()=>applied===key()?windLines:[],shade:()=>shade&&map.hasLayer(shade)?{canvas:cv,bounds:shade.getBounds()}:null,vertical:value=>units==='imperial'?`${(value*G.FT).toFixed(1)} ft/s`:`${value.toFixed(2)} m/s`,parameters,prepare,sample,atLatLng,render,snapshot,restore,terrainChanged(){applied='';if(M&&launch)requestAnimationFrame(compute);},get revision(){return revision;},get layer(){return config.enabled&&applied===key()?layer:null;},get height(){return config.enabled?config.height:10;},get scenarioKey(){return JSON.stringify(config);},get maxSpeed(){return Math.max(P.ws,field?.diagnostics?.maxSpeed||0,...activeSamples().map(p=>{const v=W.regional([p],p.lat,p.lon,config.height,config.roughness);return Math.hypot(v.east,v.north);}));},get ready(){return !config.enabled||applied===key();},get field(){return field;}};
})();
