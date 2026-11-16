// task shot -- /tag-tracker/ --eval-file script/tag-tracker/pour-visuals-browser.js (also --phone)
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setRobotView('orbit');taskLevel('bowl');draw3d();
  const renderer=robotGL(),gl=$('plotGL').getContext('webgl');assert(renderer&&gl,'the actual WebGL1 renderer is available');
  while(gl.getError()!==gl.NO_ERROR){};
  const texImage=gl.texImage2D,seen=[];
  gl.texImage2D=function(...args){if(args.length===6&&args[5] instanceof HTMLCanvasElement&&args[5].width===1024&&args[5].height===330)seen.push(gl.getParameter(gl.TEXTURE_BINDING_2D));return texImage.apply(gl,args);};
  try{
    taskLevel('pour');draw3d();
    for(let i=0;i<100&&![...renderer.labelStatus.values()].some(s=>s.ready&&!s.fallback);i++)await wait(30);
    draw3d();const label=[...renderer.labelStatus.values()].find(s=>s.title===TASK_DATA.levels.find(l=>l.id==='pour').objects.find(o=>o.kind==='bottle').artwork.title);
    assert(label?.ready&&!label.fallback,'the two-line outlined red cursive asset loads into the paper texture');
    assert(seen.length>=2,'the paper uploads once with fallback lettering and again with portable outlined script');
    const unit=gl.getParameter(gl.ACTIVE_TEXTURE);assert(unit===gl.TEXTURE0&&!gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),'label uploads restore the active shadow unit and pixel unpack orientation');
    gl.activeTexture(gl.TEXTURE1);const previous=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.bindTexture(gl.TEXTURE_2D,seen.at(-1));
    assert(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER)===gl.LINEAR&&gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S)===gl.CLAMP_TO_EDGE&&gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T)===gl.CLAMP_TO_EDGE,'non-power-of-two paper uses WebGL1-complete linear/clamp sampling');
    gl.bindTexture(gl.TEXTURE_2D,previous);gl.activeTexture(unit);
    const program=gl.getParameter(gl.CURRENT_PROGRAM);
    assert(gl.getUniform(program,gl.getUniformLocation(program,'uLabel'))===1&&gl.getUniform(program,gl.getUniformLocation(program,'uShadow'))===0,'paper and shadow samplers retain separate texture units');
    assert(gl.getError()===gl.NO_ERROR,'label, curved mug, transparent bottle and shadow passes finish without WebGL errors');
    // A real pixel check from inside and outside an isolated paper cylinder guards
    // mirrored rear text leaking through the transparent bottle. Other materials stay two-sided.
    const canvas=document.createElement('canvas'),isolated=RobotGL.create(canvas),testGL=canvas.getContext('webgl'),I=[1,0,0,0,1,0,0,0,1],paper=TaskCore.geometry('bottle',{}).find(p=>p.artwork);
    const o={w:96,h:96,dpr:1,fov:45,m:RCORE.model(),chest:{R:I,t:[0,0,0]},arms:[],body:false,mount:null,tags:[],theme:{dark:true,accent:'#9988ee',warn:'#ffeeaa',bg:'#000000'},props:{dims:{table:{size:[.5,.9],thick:.03,legs:.72},ball:{r:.03},cup:{R:.05,Ri:.043,H:.13,floor:.01},compounds:{paper:[paper]}},table:null,bodies:[{key:'paper',kind:'bottle',R:I,t:[0,0,0]}],shadows:[]}};
    const alpha=cam=>{isolated.draw({...o,cam});const pixel=new Uint8Array(4);testGL.readPixels(48,48,1,1,testGL.RGBA,testGL.UNSIGNED_BYTE,pixel);return pixel[3];};
    const inside=alpha({eye:[0,0,.075],right:[0,-1,0],up:[0,0,1],fwd:[1,0,0]}),outside=alpha({eye:[.12,0,.075],right:[0,1,0],up:[0,0,1],fwd:[-1,0,0]});
    assert(inside===0&&outside===255&&testGL.getError()===testGL.NO_ERROR,'paper prints outward only, with no mirrored lettering visible from inside the bottle');
    return {passed:true,outlinedCursive:true,redStag:true,npotTexture:true,separateShadowUnit:true,oneSidedPaper:true,webglErrors:0};
  }finally{gl.texImage2D=texImage;}
})()
