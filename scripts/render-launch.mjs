// Adapted from Barty-Bart/motion-graphics, explainer-default render contract (MIT).
// Parallel deterministic seek(t), 180-degree shutter samples, and FFmpeg encoding.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [, ,html='media/showcase/index.html',output='media/renders/isla-launch.mp4',fpsArg='60',subArg='2',workersArg='4',dprArg='2']=process.argv;
const fps=Number(fpsArg),sub=Number(subArg),workers=Number(workersArg),dpr=Number(dprArg),out=path.resolve(output);
const workspace=process.cwd()+path.sep;
if(!out.startsWith(workspace)||![fps,sub,workers,dpr].every(Number.isInteger)||fps<1||sub<1||workers<1||dpr<1||dpr>3)throw Error('Invalid render path or configuration');
await mkdir(path.dirname(out),{recursive:true});
const run=args=>new Promise((resolve,reject)=>{const p=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let errors='';p.stderr.on('data',b=>{errors+=b;});p.on('error',reject);p.on('close',c=>c?reject(Error(errors)):resolve(errors));});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--allow-file-access-from-files','--disable-dev-shm-usage']});
const url=pathToFileURL(path.resolve(html)).href+'?render';
const open=async()=>{const p=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:dpr});await p.goto(url);await p.waitForFunction(()=>window.VIDEO&&window.seek);await p.evaluate(async()=>{await Promise.all([...document.fonts].map(f=>f.load()));await document.fonts.ready;});return p;};
const probe=await open(),video=await probe.evaluate(()=>window.VIDEO);await probe.close();
const n=Math.round(video.duration*fps),per=Math.ceil(n/workers),base=out.replace(/\.mp4$/,''),segments=[];let completed=0;
try{
 await Promise.all(Array.from({length:workers},async(_,worker)=>{
  const a=worker*per,b=Math.min(n,a+per);if(a>=b)return;
  const file=base+`-part${worker}.mp4`;segments[worker]=file;
  const p=await open(),capture=await p.context().newCDPSession(p);const filters=[];
  if(dpr>1)filters.push(`scale=${video.w}:${video.h}:flags=lanczos`);
  if(sub>1)filters.push(`tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub-1})',setpts=N/(${fps}*TB)`);
  const vf=filters.length?['-vf',filters.join(',')]:[];
  const encoder=spawn('ffmpeg',['-v','error','-y','-f','image2pipe','-framerate',String(fps*sub),'-i','-','-filter_threads','2',...vf,'-r',String(fps),'-c:v','libx264','-pix_fmt','yuv420p','-crf','16','-preset','fast','-threads','2',file],{stdio:['pipe','ignore','pipe']});let errors='';encoder.stderr.on('data',b=>{errors+=b;});const end=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',c=>c?reject(Error(errors)):resolve());});
  for(let f=a;f<b;f++){
   for(let s=0;s<sub;s++){await p.evaluate(t=>window.seek(t),(f+(sub>1?s/sub*.5:0))/fps);const shot=await capture.send('Page.captureScreenshot',{format:'jpeg',quality:98,fromSurface:true,captureBeyondViewport:false});const image=Buffer.from(shot.data,'base64');if(!encoder.stdin.write(image))await new Promise(resolve=>encoder.stdin.once('drain',resolve));}
   if(++completed%120===0)console.log(`${completed}/${n} frames (${fps} fps, ${sub} shutter samples)`);
  }
  encoder.stdin.end();await end;await p.close();
 }));
 const list=base+'-concat.txt';await writeFile(list,segments.map(s=>`file '${s.replaceAll('\\','/')}'`).join('\n'));
 const silent=base+'-silent.mp4';await run(['-v','error','-y','-f','concat','-safe','0','-i',list,'-c','copy',silent]);
 const cueList=[['pop',1.15,.35],['click',2.5,.45],['whoosh',4.48,.18],['click',6.6,.4],['tick',7.15,.25],['whoosh',8.08,.18],['tick',9.4,.3],['whoosh',11.73,.14],['whoosh',13.98,.2],['pop',15.5,.3],['whoosh',17.48,.15],['click',18.3,.3],['whoosh',20.58,.16],['impact',21.8,.18]];
 const assets=path.resolve(path.dirname(html),'assets');
 const args=['-v','error','-y','-i',silent,'-i',path.join(assets,'isla-original-score.wav')];
 const filters=['[1:a]volume=0.55[bed]'];const inputs=['[bed]'];
 cueList.forEach(([name,t,gain],i)=>{args.push('-i',path.join(assets,`launch-${name}.ogg`));filters.push(`[${i+2}:a]volume=${gain},adelay=${Math.round(t*1000)}:all=1[s${i}]`);inputs.push(`[s${i}]`);});
 filters.push(inputs.join('')+`amix=inputs=${inputs.length}:duration=longest:normalize=0,atrim=duration=${video.duration}[premix]`);
 const graph=filters.join(';');
 const measurement=await run([...args.slice(0,2),'-v','info',...args.slice(2),'-filter_complex',graph+';[premix]loudnorm=I=-16:TP=-4.5:LRA=9:print_format=json[mix]','-map','[mix]','-f','null','-']);
 const measured=JSON.parse(measurement.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0]||'null');
 if(!measured)throw Error('Audio loudness measurement missing');
 const normalize=`loudnorm=I=-16:TP=-4.5:LRA=9:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
 args.push('-filter_complex',graph+';[premix]'+normalize+'[mix]','-map','0:v','-map','[mix]','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart','-t',String(video.duration),out);await run(args);
 for(const f of [...segments,list,silent])if(f.startsWith(workspace))await rm(f);
 console.log(`Launch film ready: ${out}`);
}finally{await browser.close();}
