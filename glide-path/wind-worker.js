importScripts('wind-core.js');
onmessage=e=>{try{const field=WindCore.solve(e.data.options);postMessage({key:e.data.key,field,layer:WindCore.compact(field)});}catch(error){postMessage({key:e.data.key,error:error.message});}};
