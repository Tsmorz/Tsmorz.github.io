// Capture raw IMU -> relative hand rotation. No DOM, translation estimate or TP/VQF packets.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.CaptureOrientation=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const norm=v=>Math.hypot(...v),finite=v=>Array.isArray(v)&&v.every(Number.isFinite);
  const unit=q=>{const n=norm(q);return q.map(x=>x/n);};
  const conjugate=q=>[q[0],-q[1],-q[2],-q[3]];
  const multiply=(a,b)=>[
    a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],
    a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
    a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],
    a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]
  ];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function matrix(q){
    const [w,x,y,z]=q;
    return [1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)];
  }
  function product(a,b){
    return a.map((_,i)=>{const r=3*Math.floor(i/3),c=i%3;return a[r]*b[c]+a[r+1]*b[c+3]+a[r+2]*b[c+6];});
  }
  // Capture grip: sensor X runs along the cable, Z is board up, Y is the pitch axis.
  // The hand points along -Z; its back (+X) is up in the forward-facing neutral pose.
  const SENSOR_TO_HAND=[0,0,1,0,1,0,-1,0,0];
  const HAND_TO_SENSOR=[0,0,-1,0,1,0,1,0,0];
  function gravityQuaternion(a){
    const n=norm(a),v=a.map(x=>x/n);
    return v[2]<-.999999?[0,1,0,0]:unit([1+v[2],v[1],-v[0],0]);
  }
  function fresh(s,now){return !!s?.ready&&finite(s.q)&&s.q.length===4&&Math.abs(norm(s.q)-1)<1e-6&&now>=s.at&&now-s.at<100;}

  class Estimator{
    constructor(){this.samples=0;this.epoch=0;this.reset();}
    reset(){
      this.epoch++;this.ready=false;this.q=[1,0,0,0];this.bias=[0,0,0];this.last=null;this.rest=null;this.gravity=null;
      this.snapshot={ready:false,q:this.q.slice(),at:-Infinity,epoch:this.epoch,calibrationS:0};
    }
    feed(batch,info,at){
      const scale=info?.gyro_dps_per_lsb*Math.PI/180,accelScale=info?.accel_g_per_lsb;
      if(!(info?.flags&1)||!Number.isFinite(scale)||scale<=0||!Number.isFinite(accelScale)||accelScale<=0||!Number.isFinite(at)){
        this.reset();return this.snapshot;
      }
      const key=[info.board_id,scale,accelScale,info.imu_rate_hz].join(':');
      if(this.infoKey&&key!==this.infoKey)this.reset();this.infoKey=key;
      const n=batch?.seq?.length;
      if(!n||!['t_us','gyro','accel'].every(k=>batch[k]?.length===n)){this.reset();return this.snapshot;}
      let received=false;
      for(let i=0;i<n;i++){
        const seq=batch.seq[i],t=batch.t_us[i],rawG=batch.gyro[i],rawA=batch.accel[i];
        if(!Number.isSafeInteger(t)||t<0||!Number.isInteger(seq)||seq<0||seq>0xffffffff||
          !finite(rawG)||!finite(rawA)||rawG.length!==3||rawA.length!==3||rawG.some(x=>Math.abs(x)>=32760)){
          this.reset();continue;
        }
        let dt=this.last?(t-this.last.t)*1e-6:0;
        if(this.last&&(seq!==((this.last.seq+1)>>>0)||dt<=0||dt>.02)){this.reset();dt=0;}
        this.last={seq,t};this.samples++;received=true;
        const gyro=rawG.map(x=>x*scale),acc=rawA.map(x=>x*accelScale),magnitude=norm(acc),accelValid=rawA.every(x=>Math.abs(x)<32760);
        if(!this.ready){
          // A stationary window measures bias rather than assuming a factory gyro zero.
          if(!accelValid||magnitude<.85||magnitude>1.15||norm(gyro)>.35){this.rest=null;continue;}
          let r=this.rest;
          if(!r)r=this.rest={start:t,n:0,g:[0,0,0],a:[0,0,0],gv:[0,0,0],av:[0,0,0]};
          r.n++;
          for(let k=0;k<3;k++){
            const dg=gyro[k]-r.g[k],da=acc[k]-r.a[k];r.g[k]+=dg/r.n;r.a[k]+=da/r.n;
            r.gv[k]+=dg*(gyro[k]-r.g[k]);r.av[k]+=da*(acc[k]-r.a[k]);
          }
          // Capture-board rest noise can exceed 0.5 degrees/s; retain the 1.5 degrees/s rest tolerance.
          if(r.n>10&&(r.gv.some(x=>x/r.n>(1.5*Math.PI/180)**2)||r.av.some(x=>x/r.n>.025**2))){this.rest=null;continue;}
          if(t-r.start>=2e6&&r.n>=20){this.bias=r.g.slice();this.gravity=[0,0,norm(r.a)];this.q=gravityQuaternion(r.a);this.ready=true;}
          continue;
        }
        const omega=gyro.map((x,k)=>x-this.bias[k]);
        const angle=norm(omega)*dt;
        if(angle>0){const gain=Math.sin(angle/2)/norm(omega);this.q=unit(multiply(this.q,[Math.cos(angle/2),...omega.map(x=>x*gain)]));}
        // Slow gravity correction rejects large linear accelerations and filters actuator vibration.
        if(accelValid&&magnitude>.9&&magnitude<1.1){
          const weight=1-Math.exp(-dt/.15),R=matrix(this.q);
          const world=[0,1,2].map(k=>R[k*3]*acc[0]+R[k*3+1]*acc[1]+R[k*3+2]*acc[2]);
          // Filter in the gyro-propagated world frame so real turns do not lag the accelerometer.
          this.gravity=this.gravity.map((x,k)=>x+weight*(world[k]-x));
          const gnorm=norm(this.gravity),error=cross(this.gravity.map(x=>x/gnorm),[0,0,1]),turn=norm(error)*1.5*dt;
          if(turn>0){const gain=Math.sin(turn/2)/norm(error);this.q=unit(multiply([Math.cos(turn/2),...error.map(x=>x*gain)],this.q));}
        }
      }
      if(received)this.snapshot={ready:this.ready,q:this.q.slice(),at,epoch:this.epoch,t_us:this.last?.t,seq:this.last?.seq,
        calibrationS:this.ready?2:this.rest&&this.last?Math.min(2,(this.last.t-this.rest.start)/1e6):0};
      return this.snapshot;
    }
  }

  class Control{
    clear(){this.neutral=null;this.paused=false;}
    zero(sample,R,side,frame,now){
      if(!fresh(sample,now)||!finite(R)||R.length!==9||![1,-1].includes(side))return false;
      this.neutral={q:sample.q.slice(),R:R.slice(),side,frame,epoch:sample.epoch};this.last=R.slice();this.paused=false;return true;
    }
    rotation(sample,side,frame,now,active){
      const n=this.neutral;if(!n)return null;
      if(n.side!==side||n.frame!==frame){this.clear();return null;}
      if(!active||!fresh(sample,now)||sample.epoch!==n.epoch)this.paused=true;
      // A delayed/restarted/background stream holds its last target until explicitly re-centred.
      if(!this.paused)this.last=product(n.R,product(product(SENSOR_TO_HAND,matrix(multiply(conjugate(n.q),sample.q))),HAND_TO_SENSOR));
      return this.last.slice();
    }
  }
  return {Estimator,Control,fresh};
});
