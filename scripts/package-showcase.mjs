// Publishable previews must come from the completed film, not a separate animation.
import {spawn} from 'node:child_process';
import {copyFile,stat} from 'node:fs/promises';

const input='media/renders/isla-launch-1080p60.mp4';
const dest='docs/media';
const ffmpeg=args=>new Promise((resolve,reject)=>{
  const process=spawn('ffmpeg',['-v','error','-y',...args],{stdio:['ignore','ignore','inherit']});
  process.on('error',reject);
  process.on('close',code=>code?reject(new Error(`FFmpeg exited ${code}`)):resolve());
});

await copyFile(input,`${dest}/isla-launch-1080p60.mp4`);
for(const [name,time] of [['hero',2.1],['player',5.9],['equalizer',8.9]]){
  await ffmpeg(['-ss',String(time),'-i',input,'-frames:v','1',`${dest}/${name}.png`]);
}
async function gif(fps,width,colors){
  const filter=`[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[v][p];[p]palettegen=max_colors=${colors}:stats_mode=diff[pal];[v][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  await ffmpeg(['-i',input,'-filter_complex',filter,'-loop','0',`${dest}/showcase.gif`]);
}
await gif(12,800,96);
if((await stat(`${dest}/showcase.gif`)).size>9_500_000)await gif(10,760,80);
console.log('Packaged launch MP4, posters and README GIF in docs/media.');
