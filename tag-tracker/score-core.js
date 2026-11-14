// Local device leaderboard. Full and small tasks, revisions and player names never share a ranking.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TaskScores=factory();})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const player=s=>String(s||'Player 1').trim().replace(/[\u0000-\u001f]/g,'').slice(0,32)||'Player 1';
  const key=(level,mode)=>mode+':'+level.id+':'+(level.revision||1);
  function clean(raw){
    if(!Array.isArray(raw))return [];
    return raw.filter(r=>r&&typeof r.task==='string'&&r.task.length<100&&Number.isFinite(r.seconds)&&r.seconds>0&&r.seconds<=86400&&Number.isFinite(r.at)).map(r=>({task:r.task,player:player(r.player),seconds:r.seconds,at:r.at})).sort((a,b)=>a.seconds-b.seconds||a.at-b.at).slice(0,1000);
  }
  const ranking=(rows,level,mode)=>clean(rows).filter(r=>r.task===key(level,mode)).slice(0,10);
  function record(rows,level,mode,name,seconds,at=Date.now()){
    const r={task:key(level,mode),player:player(name),seconds,at},all=clean(rows),old=all.find(x=>x.task===r.task&&x.player===r.player);
    if(old&&old.seconds<=seconds)return all;
    return clean([...all.filter(x=>x!==old),r]);
  }
  function format(seconds){if(!Number.isFinite(seconds))return '—';const ms=Math.round(Math.max(0,seconds)*1000);return Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');}
  return {player,key,clean,ranking,record,format};
});
