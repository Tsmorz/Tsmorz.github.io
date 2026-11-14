// task build && task shot -- /glide-path/ --eval-file tests/glide/soaring.js --console
// Repeat with --phone; weather is mocked, terrain is the actual Dinosaur Park mosaic.
(async()=>{
 const e=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m);};
 const wait=async(fn,m)=>{const end=Date.now()+30000;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+m+'; '+e('dsStatus').textContent);await new Promise(r=>setTimeout(r,100));}};
 e('guide').close();await wait(()=>e('app').dataset.calc==='ready','terrain ready');
 assert(document.title.includes('Dyna-soar') && e('head').textContent.includes('Dyna-soar'),'brand name present');
 assert(Math.abs(+e('launchLat').value-44.077964)<1e-6 && Math.abs(+e('launchLon').value+103.245844)<1e-6,'default is the exact statue, not a snapped neighbouring peak');
 assert(e('head').querySelector('img').naturalWidth>0,'dinosaur illustration loaded');
 const realFetch=window.fetch;let direction=270,speed=6,pending=null,mode='success',points=[];
 window.fetch=async(url,opt)=>{
  if(String(url).startsWith('https://api.open-meteo.com/')){
   const u=new URL(url),lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);points=lat.map((value,i)=>({lat:value,lon:lon[i]}));
   if(mode==='pending')return new Promise(resolve=>{pending=resolve;});
   if(mode==='error')return new Response('unavailable',{status:503});
   return reply();
  }return realFetch(url,opt);
 };
 function reply(){return new Response(JSON.stringify(points.map((p,i)=>({latitude:p.lat,longitude:p.lon,current_units:{time:'unixtime',wind_speed_10m:'m/s',wind_direction_10m:'°',wind_gusts_10m:'m/s',wind_speed_80m:'m/s',wind_direction_80m:'°'},current:{time:Math.floor(Date.now()/1000),wind_speed_10m:speed+i*.12,wind_direction_10m:direction+(i?(i%3-1)*12:0),wind_gusts_10m:speed+2,wind_speed_80m:speed*1.25+i*.12,wind_direction_80m:direction+(i?(i%3-1)*12:0)}}))),{status:200,headers:{'Content-Type':'application/json'}});}

 if(compact.matches)e('settingsToggle').click();
 e('fetchWind').click();await wait(()=>!e('fetchWind').disabled && e('app').dataset.calc==='ready' && Gres?.key===runKey(),'model wind applied to reach');
 assert(points.length===9&&windUI.field?.state==='terrain'&&windUI.field.diagnostics.converged,'regional samples initialise a converged terrain flow solve');
 assert(windUI.field.up.some(v=>v>.2)&&windUI.field.up.some(v=>v<-.2),'terrain model resolves estimated lift and sink');
 assert(document.querySelectorAll('.wind-vector').length>0,'map shows a spatial wind field');
 assert(P.ws===6&&P.wd===270 && e('windSource').textContent.includes('model grid points'),'forecast applied with source and height');
 const east=R.dmax[180],west=R.dmax[540],eastRatio=R.grg[180],oldGridKey=Gres.key;
 const checksum=()=>{const c=overlayCanvas.getContext('2d').getImageData(0,0,overlayCanvas.width,overlayCanvas.height).data;let sum=0;for(let i=0;i<c.length;i+=37)sum=(sum+c[i])%1000000007;return sum;};
 const priorOverlay=checksum();
 await wait(()=>!['Loading detailed terrain for ridge screening…','Screening ridges for this wind…'].includes(e('dsStatus').textContent),'ridge screening');
 assert(e('dsStatus').textContent && !e('dsStatus').textContent.includes('0.5'),'wind changes trigger ridge screening too');
 const buttons=e('dsCandidates').querySelectorAll('button');
 assert(buttons.length>0,'real Dinosaur Park terrain produces candidate ridge geometry in westerly wind');
 buttons[0].click();await wait(()=>PROF?.kind==='soaring'&&PROF.img,'ridge profile');
 assert(soaringUI.view==='soaring'&&e('btnFly').disabled,'ridge profile cannot be flown as a predicted soaring trajectory');
 assert(e('profWhat').textContent.includes('projected flow estimate'),'profile distinguishes terrain from airflow');
 const sectionStart=PROF.lls[0],sectionEnd=PROF.lls.at(-1),ridgeHeading=GP.wrap(Math.atan2((sectionEnd.lng-sectionStart.lng)*Math.cos(sectionStart.lat*Math.PI/180),sectionEnd.lat-sectionStart.lat)*180/Math.PI);
 await wait(()=>view3d?.camera && Math.abs(GP.wrap(view3d.camera.bearing)-ridgeHeading)<1,'ridge selection faces downwind');
 assert(view3d.camera.pitch===0,'ridge selection keeps a flat map flat');
 assert(view3d.camera.zoom>=15.5,'ridge selection zooms in to make the crest and side labels legible');
 assert(document.querySelector('.map3d .launch-pin')?.textContent==='L','rotated view keeps the square launch marker');
 await wait(()=>document.querySelectorAll('.map3d .ridge-label').length===2,'ridge side labels');
 assert(document.querySelector('.map3d .ds-pin.selected').textContent.includes('Ridge'),'map pins use plain ridge labels');
 assert(e('ws').closest('[data-sec=wind]')===e('fetchWind').closest('[data-sec=wind]'),'manual and local wind share one section');
 assert(!document.querySelector('.wind-advanced').open,'advanced terrain assumptions fold away');
 assert(e('mapLeft').getBoundingClientRect().width>=40&&e('mapRight').getBoundingClientRect().height>=40,'rotation controls keep touch-sized targets');
 e('mapRight').click(); await wait(()=>Math.abs(GP.wrap(view3d.camera.bearing)-GP.wrap(ridgeHeading+15))<1,'turn right');
 assert(Math.abs(mapHeading-GP.wrap(ridgeHeading+15))<1,'heading readout follows camera');
 e('mapLeft').click(); await wait(()=>Math.abs(mapHeading-ridgeHeading)<1,'turn left');
 e('mapNorth').click(); await wait(()=>Math.abs(mapHeading)<1,'north reset');
 const localWind=windUI.atLatLng(launch),windTo=GP.wrap(WindCore.bearing(localWind.east,localWind.north)+180);
 assert(Math.abs(parseFloat(e('windMap').querySelector('.wind-arrow').style.transform.slice(7))-windTo)<1,'wind arrow is screen relative after north reset');
 e('mapHeading').value='270';e('mapHeading').dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>Math.abs(GP.wrap(view3d.camera.bearing)-270)<1,'exact map heading');
 await set3d(true,62);assert(Math.abs(view3d.camera.pitch-62)<1&&Math.abs(mapHeading-270)<1,'tilt preserves orientation');
 await set3d(true,0);assert(view3d.camera.pitch===0,'2D restores a rotatable flat view');
 soaringUI.setView('glide');e('bearingValue').value='135';e('bearingValue').dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>Math.abs(mapHeading-135)<1,'cross-section heading rotates the map');
 e('dsCandidates').querySelector('button').click();await wait(()=>PROF?.kind==='soaring'&&PROF.img,'ridge profile reselected');
 e('profile').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
 assert(view3d.project(PROF.lls.at(-1)).x>=0,'scrubbing keeps the probe in the rotated map');
 const probePoint=view3d.project(PROF.lls[3]);mapHover(probePoint,p=>view3d.project(p));
 assert(cursorFrom==='map'&&!e('profTip').hidden,'rotated-map hover inspects the same section');
 assert(e('profTip').textContent.includes('Estimated vertical air')&&e('profTip').textContent.includes('Wind shear not measured'),'cursor reports the physical limit');
 if(compact.matches)e('settingsToggle').click();
 direction=90;e('fetchWind').click();await wait(()=>!e('fetchWind').disabled&&e('app').dataset.calc==='ready'&&Gres?.key===runKey()&&Gres.key!==oldGridKey,'reversed wind map update');
 assert(P.wd===90&&R.grg[180]<eastRatio,'wind reversal changes the effective glide ratio');
 assert(R.dmax[180]<=east+1 && R.dmax[540]>=west-1,'straight glide envelope responds in both upwind and downwind directions');
 assert(checksum()!==priorOverlay,'the entire coloured reach overlay is recomputed');
 assert(e('stats').textContent.includes('Potential landing ground'),'landing area statistics survive the wind update');
 // A different reference layer changes horizontal reach, not just its label.
 const oldRevision=windUI.revision;e('windHeight').value=80*(units==='imperial'?G.FT:1);e('windHeight').dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>windUI.revision>oldRevision&&windUI.ready&&e('app').dataset.calc==='ready'&&Gres?.key===runKey(),'wind layer recalculation');
 assert(Math.abs(windUI.height-80)<.01&&e('flowStatus').textContent.includes('AGL'),'selected layer is explicit');
 e('ridgeShading').checked=true;e('ridgeShading').dispatchEvent(new Event('change',{bubbles:true}));assert(windUI.shade(),'vertical-air shading is a separate overlay');
 const saved={version:1,launch,params:P,target:null,units,windModel:windUI.snapshot()},decoded=GP.decode(GP.encode(saved));assert(decoded.windModel.samples.length===9&&decoded.windModel.height===80,'a share link preserves the regional wind and height assumptions');
 // Wind errors and delayed replies must preserve an edited flight plan.
 const before=[P.ws,P.wd].join();mode='error';e('fetchWind').click();await wait(()=>!e('fetchWind').disabled,'provider error');
 assert([P.ws,P.wd].join()===before&&e('windSource').textContent.includes('unavailable'),'failed forecast preserves manual wind');
 mode='pending';e('fetchWind').click();await wait(()=>pending,'request in flight');
 e('windBearing').value='180';e('windBearing').dispatchEvent(new Event('change',{bubbles:true}));pending(reply());
 await wait(()=>!e('fetchWind').disabled,'late forecast rejected');assert(P.wd===180&&e('windSource').textContent.includes('changed while loading'),'a late forecast cannot overwrite a changed wind setting');
 // Return to the illustrated site's westerly candidate view for visual review.
 mode='success';direction=270;e('fetchWind').click();await wait(()=>!e('fetchWind').disabled&&windUI.ready&&e('app').dataset.calc==='ready'&&Gres?.key===runKey()&&soaringUI.features().key&&e('dsCandidates').querySelector('button'),'candidate view restored');
 e('dsCandidates').querySelector('button').click();await wait(()=>PROF?.kind==='soaring'&&PROF.img,'profile restored');
 await wait(()=>document.querySelectorAll('.map3d .ridge-label').length===2,'final ridge labels restored');
 window.fetch=realFetch;
 assert(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');
 if(compact.matches)assert(e('settingsToggle').getBoundingClientRect().bottom<=innerHeight+1,'settings stay in the viewport');
 console.log('PASS: heading rotation, north reset, tilt, grouped wind controls, crest/lee labels, Dyna-soar branding, exact Dinosaur Park default, model wind provenance, whole-envelope wind reversal, ridge candidates, wind profile, errors and stale weather replies');
})();
