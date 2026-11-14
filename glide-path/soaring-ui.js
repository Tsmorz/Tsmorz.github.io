// Dyna-soar's ridge screen and local model wind. Shares the page's map, SI plan and profile cursor.
// The scan runs in the existing worker; its markings never modify glide reach or imply energy gain.
soaringUI = (() => {
  'use strict';
  const S = SoaringCore, marks = L.layerGroup().addTo(map);
  let enabled = LS.get('soaring', true) !== false, view = 'glide', ground = null, serial = 0;
  let result = null, resultKey = '', selected = null, screenBusy = false, nextScreen = null, loadingFine = false;

  const status = state => { $('dsStatus').textContent = CONTENT.soaring.states[state] || state; };
  const ll = (x,y) => { const [lon,lat] = G.pxToLonLat(ground.x0+2*x+1,ground.y0+2*y+1,ground.z); return L.latLng(lat,lon); };
  const launchXY = () => { const [x,y] = G.lonLatToPx(launch.lng,launch.lat,ground.z); return [(x-ground.x0-1)/2,(y-ground.y0-1)/2]; };
  const key = () => launch && ground ? [ground.id,launch.lat,launch.lng,P.wd,P.ws,P.vis,windUI?.revision||0].join() : '';
  function setGround(m) {
    const W = m.W/2, terr = new Float32Array(W*W);
    for (let y=0;y<W;y++) for(let x=0;x<W;x++) { const i=2*y*m.W+2*x; terr[y*W+x]=Math.max(m.data[i],m.data[i+1],m.data[i+m.W],m.data[i+m.W+1]); }
    ground = { id: ++serial, W, terr, cell: 2*m.mpp, x0:m.x0,y0:m.y0,z:m.z,failed:m.failed };
    if (worker) worker.postMessage({ screenGrid: { id:ground.id,terr:terr.slice(),W } });
    result=null; resultKey=''; selected=null; marks.clearLayers();windUI?.terrainChanged();
  }
  function terrain(m) { if(m.z===Z_MAX) setGround(m); }
  function covers() {
    if(!ground || !launch) return false;
    const [x,y] = launchXY(), r=Math.max(P.vis+220,Math.max(800,P.vis*1.35)+220)/ground.cell;
    return x-r>=0 && y-r>=0 && x+r<ground.W-1 && y+r<ground.W-1;
  }
  async function ensureGround(force = false, forWind = false) {
    if(loadingFine || !launch || (!enabled&&!forWind)) return;
    if(!force && covers()) { run(); return; }
    if(M?.z===Z_MAX && !force) { if(!ground) setGround(M); if(covers()) { run(); return; } }
    loadingFine=true; status('loading'); marks.clearLayers(); result=null; resultKey='';
    const point={lat:launch.lat,lon:launch.lng};
    try { const m=await loadMosaic(point.lat,point.lon,Z_MAX,()=>{},Math.max(2, Math.ceil((Math.max(P.vis+240,Math.max(800,P.vis*1.35)+240))/(G.mppAt(point.lat,Z_MAX)*TS)))); if(launch && point.lat===launch.lat && point.lon===launch.lng) setGround(m); }
    finally { loadingFine=false; }
    run();
  }
  function sendScreen(job) {
    if(screenBusy) { nextScreen=job; return; }
    screenBusy=true;
    if(worker) worker.postMessage({screen:job,screenGridId:ground.id});
    else setTimeout(()=>onMessage({screen:true,key:job.key,result:S.scan(job,ground.terr,ground.W)}),0);
  }
  function run() {
    $('retryScreen').hidden = true;
    if(!enabled) { status('off'); marks.clearLayers(); return; }
    if(!launch || loading) { status('loading'); return; }
    if(!covers()) { ensureGround(); return; }
    const current=key();
    if(resultKey===current && result) { render(); return; }
    if(P.ws<=S.LIMITS.calm&&!windUI?.layer) { result={state:'calm',candidates:[]};resultKey=current;render();return; }
    const [si,sj]=launchXY(); status('updating'); marks.clearLayers(); $('dsCandidates').replaceChildren();
    sendScreen({key:current,cell:ground.cell,si,sj,maxR:P.vis,windSpeed:P.ws,windFromDeg:P.wd,wind:windUI?.layer||null});
  }
  function onMessage(message) {
    screenBusy=false;
    if(message.key===key() && enabled) { result=message.result;resultKey=message.key;render();if(view==='soaring') drawProfile(); }
    if(nextScreen) { const job=nextScreen;nextScreen=null;if(job.key===key()) sendScreen(job); }
  }
  function render() {
    if(!enabled || resultKey!==key() || !result) return;
    marks.clearLayers();$('dsCandidates').replaceChildren();
    const list=result.candidates;
    if(selected && !list.some(c=>c.x===selected.x && c.y===selected.y)) selected=null;
    if(!selected && list.length) selected=list[0];
    mark3d();
    status(ground.failed && !list.length && result.state==='none' ? 'missing' : result.state);
    if(ground.failed && list.length) $('dsStatus').textContent += ' Some terrain is missing; other ridges may be absent.';
    $('sumSoaring').textContent=list.length ? `${list.length} candidates` : result.state==='calm' ? 'set wind' : 'screen';
    $('retryScreen').hidden=!ground.failed;
    list.forEach((c,index)=>{
      const point=ll(c.x,c.y), v=S.flow(c.windFrom), width=50/ground.cell, depth=c.run/ground.cell;
      const xy=(along,across)=>ll(c.x+v.x*along-v.y*across,c.y+v.y*along+v.x*across);
      const selectedHere=selected===c;
      const polygon=L.polygon([xy(0,-width),xy(0,width),xy(depth,width*.7),xy(depth,-width*.7)],
        {color:C.casing,weight:6,fill:false,interactive:false}).addTo(marks);
      L.polygon(polygon.getLatLngs(),{color:C.line,weight:2,dashArray:'5 4',fill:false,interactive:false}).addTo(marks);
      const pin=L.marker(point,{icon:L.divIcon({className:'ds-pin'+(selectedHere?' selected':''),html:`<span>DS? ${index+1}</span>`,iconSize:[54,40],iconAnchor:[27,20]}),title:`Candidate ridge ${index+1}: inspect wind profile`,keyboard:true}).addTo(marks);
      pin.on('click',e=>{if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);select(c);});
      const li=document.createElement('li'), b=document.createElement('button');b.type='button';b.className='ds-candidate';b.setAttribute('aria-pressed',String(selectedHere && view==='soaring'));
      const name=document.createElement('b'), detail=document.createElement('span');name.textContent=`Ridge ${index+1} · ${U.d(c.distance)} away`;
      detail.textContent=`Windward rise ${U.h(c.rise)} · lee drop ${U.h(c.drop)} · ${c.leeAngle.toFixed(0)}°`;
      b.append(name,detail);b.onclick=()=>select(c);li.append(b);$('dsCandidates').append(li);
    });
  }
  function features() {
    if(!enabled || !result || resultKey!==key())return {key:'',items:[]};
    const items=result.candidates.map((c,index)=>{
      const v=S.flow(c.windFrom),w=50/ground.cell,d=c.run/ground.cell;
      const xy=(a,b)=>ll(c.x+v.x*a-v.y*b,c.y+v.y*a+v.x*b);
      return {index,point:ll(c.x,c.y),selected:selected===c,outline:[xy(0,-w),xy(0,w),xy(d,w*.7),xy(d,-w*.7),xy(0,-w)]};
    });
    return {key:resultKey+':'+(selected?selected.x+','+selected.y:''),items};
  }
  function select(candidate) {
    selected=candidate;setView('soaring');setProfile(true);render();
    if(compact.matches) setDrawer(false);
    map.panInside(ll(candidate.x,candidate.y),{padding:[70,70]});
  }
  function setView(value,redraw=true) {
    view=value;$('prof').dataset.view=value;
    document.querySelectorAll('[data-profile]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.profile===value)));
    $('profile').setAttribute('aria-label',value==='soaring'?'Terrain along the wind through the selected ridge. Dashed crest line; the lee is downwind. Arrow keys inspect the ground.':'Cross-section: glider and ground height. Use left and right arrows to inspect.');
    hideCursor(); if(redraw){drawProfile();map.invalidateSize();}
  }
  function ridgeProfile() {
    if(!selected || resultKey!==key() || !ground || !enabled) return null;
    const p=S.section(selected,ground.terr,ground.W,ground.W,ground.cell);
    return {...p,wind:p.xy.map(([x,y])=>windUI?.atLatLng(ll(x,y))||null),kind:'soaring',glide:p.d.map(()=>NaN),end:p.d.length-1,hit:false,curve:false,lls:p.xy.map(([x,y])=>ll(x,y))};
  }
  function drawRidgeProfile() {
    const cv=$('profile'), p=ridgeProfile();$('btnFly').disabled=true;
    const local=p&&windUI?windUI.atLatLng(ll(selected.x,selected.y)):null;
    $('profWhat').textContent=p?`Local wind ${U.v(local?Math.hypot(local.east,local.north):P.ws)} from ${compass(local?WindCore.bearing(local.east,local.north):P.wd)} · projected flow estimate · lift/sink excluded from reach.`:'Choose a candidate ridge from the map or Dynamic soaring panel.';
    if(!p) { PROF=null;clearTrace();const ctx=cv.getContext('2d');ctx.clearRect(0,0,cv.width,cv.height);return; }
    if($('app').classList.contains('profile-off')) { PROF=p;drawTrace(p,[]);return; }
    const W=cv.clientWidth,H=cv.clientHeight,dpr=devicePixelRatio||1;if(!W||!H)return;
    cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.setTransform(dpr,0,0,dpr,0,0);
    const valid=p.ground.filter(Number.isFinite);if(!valid.length)return;
    const lo=Math.min(...valid)-8,hi=Math.max(...valid)+Math.max(110,(windUI?.height||30)+30),L0=52,R0=14,T0=22,B0=23;
    const X=d=>L0+d/p.span*(W-L0-R0),Y=h=>T0+(hi-h)/(hi-lo)*(H-T0-B0);
    PROF={...p,X,Y,L0,R0,T0,B0,Wc:W,Hc:H,dMax:p.span};
    ctx.font='11px system-ui';ctx.strokeStyle=COL.line;ctx.fillStyle=COL.muted;ctx.lineWidth=1;ctx.textAlign='right';ctx.textBaseline='middle';
    const step=niceStep((hi-lo)/(H<100?2:3));
    for(let h=Math.ceil(lo/step)*step;h<hi;h+=step){ctx.beginPath();ctx.moveTo(L0,Y(h));ctx.lineTo(W-R0,Y(h));ctx.stroke();ctx.fillText(U.h(h),L0-5,Y(h));}
    let start=0;while(start<p.d.length){while(start<p.d.length&&!Number.isFinite(p.ground[start]))start++;if(start===p.d.length)break;let end=start;ctx.beginPath();ctx.moveTo(X(p.d[start]),H-B0);while(end<p.d.length&&Number.isFinite(p.ground[end])){ctx.lineTo(X(p.d[end]),Y(p.ground[end]));end++;}ctx.lineTo(X(p.d[end-1]),H-B0);ctx.closePath();ctx.fillStyle=COL.terrain;ctx.fill();ctx.strokeStyle=COL.terrainEdge;ctx.stroke();start=end;}
    ctx.setLineDash([4,4]);ctx.strokeStyle=COL.ink2;ctx.beginPath();ctx.moveTo(X(p.crest),T0);ctx.lineTo(X(p.crest),H-B0);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=COL.ink2;ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.fillText('Upwind →',L0,13);ctx.textAlign='right';ctx.fillText('Lee / downwind',W-R0,13);
    ctx.textAlign='center';ctx.fillStyle=COL.muted;const ticks=[0,p.crest,p.span];
    for(const d of ticks){ctx.textAlign=d===0?'left':d===p.span?'right':'center';ctx.fillText(d===p.crest?'Crest':`${d<p.crest?'−':'+'}${U.d(p.crest)}`,X(d),H-5);}
    if(windUI?.ready&&windUI?.field?.state==='terrain'){
      const direction=S.flow(selected.windFrom),stepD=p.span/70;
      ctx.strokeStyle=COL.curve;ctx.lineWidth=1.2;ctx.setLineDash([4,3]);
      for(const startHeight of [15,45,85]){
        let z=p.ground[0]+startHeight;ctx.beginPath();ctx.moveTo(X(0),Y(z));
        for(let d=stepD;d<=p.span;d+=stepD){const point=llAt(p,d),k=Math.min(p.ground.length-1,Math.round(d/p.span*(p.ground.length-1))),h=p.ground[k];if(!Number.isFinite(h)||z<h+2)break;const v=windUI.atLatLng(point,z-h),along=v.east*direction.x-v.north*direction.y;if(along<.2)break;z+=v.up/along*stepD;if(z<h+2||z>hi)break;ctx.lineTo(X(d),Y(z));}ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    PROF.img=ctx.getImageData(0,0,cv.width,cv.height);drawTrace(p,ticks);
  }
  function tip(k) { const d=PROF.d[k]-PROF.crest,v=PROF.wind?.[k],point=PROF.lls[k];
    let text=`<b>${U.d(Math.abs(d))} ${d<0?'upwind':'downwind'} of crest</b><br>Ground MSL ${U.h(PROF.ground[k])}`;
    if(v){const low=windUI.atLatLng(point,10),high=windUI.atLatLng(point,80),delta=Math.hypot(high.east-low.east,high.north-low.north);text+=`<br>Wind @ ${U.h(windUI.height)} AGL ${U.v(Math.hypot(v.east,v.north))}<br>Estimated vertical air ${windUI.vertical(v.up)}<br>Δ wind 10–80 m ${U.v(delta)}`;}
    return text+'<br>Wind shear not measured';
  }

  function parameters() {

    if(resultKey && resultKey!==key()){marks.clearLayers();mark3d();$('dsCandidates').replaceChildren();status('updating');}
    if(!enabled)status('off');
    else if(result && resultKey===key())render();
    if(view==='soaring' && resultKey!==key()) drawRidgeProfile();
  }
  $('dsEnabled').checked=enabled;
  $('dsEnabled').onchange=()=>{enabled=$('dsEnabled').checked;LS.set('soaring',enabled);if(!enabled){marks.clearLayers();mark3d();$('dsCandidates').replaceChildren();$('sumSoaring').textContent='off';status('off');if(view==='soaring')drawProfile();}else run();};
  $('retryScreen').onclick=()=>{ground=null;ensureGround(true);};
  document.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{setView(b.dataset.profile);if(view==='soaring'){document.querySelector('[data-sec=soaring]').open=true;if(!selected)run();}render();});

  status(enabled?'calm':'off');
  // The shell can finish loading before this script on an exceptionally fast cache hit.
  if(M){terrain(M);run();}
  return {ensureTerrain:()=>ensureGround(false,true),parameters,terrain,run,onMessage,features,selectIndex(index){const c=result?.candidates[index];if(c)select(c);},workerFailed(){screenBusy=false;nextScreen=null;resultKey='';run();},drawProfile:drawRidgeProfile,setView,tip,get terrainData(){return ground;},get view(){return view;}};
})();
