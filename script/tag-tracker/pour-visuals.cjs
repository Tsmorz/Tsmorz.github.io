// Display-only beer props retain their physical shells, mass, openings and grip geometry.
module.exports=function({check}){
  const path=require('path'),fs=require('fs'),root=path.resolve(__dirname,'../..'),T=require(root+'/tag-tracker/task-core'),G=require(root+'/tag-tracker/robot-gl'),R=require(root+'/tag-tracker/robot-core');
  const data=JSON.parse(require('child_process').execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'])),level=data.levels.find(l=>l.id==='pour'),art=level.objects.find(o=>o.kind==='bottle').artwork;
  const bottle=T.geometry('bottle',art),stein=T.geometry('stein'),label=bottle.filter(s=>s.visual),solid=bottle.filter(s=>!s.visual),mugSolid=stein.filter(s=>!s.visual),I=[1,0,0,0,1,0,0,0,1];
  check(label.length===1&&label[0].material==='label'&&label[0].type==='cylinder'&&label[0].p[2]+label[0].h<T.BOTTLE.neck.z0&&solid.every((p,i)=>p.r===T.BOTTLE.outside[i].r&&p.h===(T.BOTTLE.outside[i].z1-T.BOTTLE.outside[i].z0)/2),'bottle has one paper label, no blue/gold ornaments, and unchanged glass collision sections and clear neck');
  const outline=fs.readFileSync(path.join(root,'tag-tracker',art.lettering),'utf8');
  check(art.title==='Münchener Weißbier'&&outline.includes('<path')&&!outline.includes('<text'),'data supplies the exact umlauts and ß; portable cursive lettering is outlined instead of requiring an installed font');
  const rendered=G.compoundMeshes(bottle),paper=rendered.filter(p=>p.artwork),glass=G.profileSampler(bottle[0].profile);
  const valid=p=>p.mesh.pos.length/3<=65535&&[...p.mesh.pos,...p.mesh.nrm,...p.mesh.uv||[]].every(Number.isFinite)&&p.mesh.idx.every(i=>i<p.mesh.pos.length/3)&&Array.from({length:p.mesh.nrm.length/3},(_,i)=>Math.abs(Math.hypot(...p.mesh.nrm.slice(i*3,i*3+3))-1)<1e-5).every(Boolean);
  let separation=true;for(let i=0;i<=500;i++){const [r,z]=glass(i/500);if(z>=label[0].p[2]-label[0].h&&z<=label[0].p[2]+label[0].h)separation=separation&&label[0].r-r>=.001-1e-8;}
  check(paper.length===1&&paper[0].mesh.uv.length===paper[0].mesh.pos.length/3*2&&paper[0].mesh.uv.every(v=>v>=0&&v<=1)&&paper[0].mesh.idx.length===96*2*6&&separation&&rendered.every(valid),'paper uses normalized UVs on a cap-free curved side, stays ≥1 mm above glass, and has finite WebGL1-safe buffers');
  const mug=G.compoundMeshes(stein),profile=G.profileSampler(stein[0].profile);let bounded=true;for(let i=0;i<=1000;i++){const [r,z]=profile(i/1000);bounded=bounded&&r>=-1e-9&&r<=T.STEIN.R+1e-9&&z>=-1e-9&&z<=T.STEIN.H+1e-9;}
  check(mugSolid.length===32&&stein.some(p=>p.type==='stein-handle'&&p.visual)&&stein.some(p=>p.type==='lozenges'&&p.material==='labelBand')&&mug.every(valid)&&bounded,'stein retains blue/white lozenges and all 32 collision pieces while its rounded handle and wall/lip profile render smoothly without overshoot');
  const game=T.create(level,{R:I,t:[0,0,0],size:[.5,.9]},R.gripper(R.model())),b=game.byKey.get('bottle'),m=game.byKey.get('mug');
  check(b.dryMass.mass===.3&&Math.abs(b.m-.8)<1e-12&&m.m===.25&&b.pieces.length===solid.length&&m.pieces.length===mugSolid.length&&m.gripZone.min[0]===T.STEIN.R+.002&&b.drawn.find(p=>p.artwork).artwork.title===art.title&&game.pour.from.V0===.0005,'artwork preserves dry prop mass, handle-only grip and beer volume while the full bottle includes its real liquid load');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
