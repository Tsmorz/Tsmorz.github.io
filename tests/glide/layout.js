// After task build: task shot -- /glide-path/ --size 844x390 --eval-file tests/glide/layout.js
// Repeat at 320x568 to check the smallest portrait layout with destination and expanded profile.
(async()=>{
$('guide').close();
while($('app').dataset.calc !== 'ready') await new Promise(r=>setTimeout(r,100));
map.fire('click',{latlng:L.latLng(launch.lat+0.002,launch.lng+0.002)});
setProfile(true);
await new Promise(r=>setTimeout(r,200));
if($('settingsToggle').getBoundingClientRect().bottom > innerHeight + 1) throw new Error('Settings button fell below the viewport');
console.log(JSON.stringify({height:innerHeight,scrollHeight:document.documentElement.scrollHeight,footer:$('settingsToggle').getBoundingClientRect().bottom,map:$('map').getBoundingClientRect().height}));
})();
