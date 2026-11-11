import {useRef} from 'react';
import {motion,useIsPresent} from 'motion/react';
import {Volume2,VolumeX} from 'lucide-react';
import {contentSpring} from '../utils/motion';

export function CompactVolume({volume,side,accentColor,reduced,onWheelVolume}:{volume:number;side:string;accentColor:string;reduced:boolean;onWheelVolume:(value:number)=>void}) {
  const wheel=useRef({value:volume,at:0});
  const present=useIsPresent();
  return <motion.div data-island-hit-region inert={!present} aria-hidden={!present} className="absolute inset-0 z-10 rounded-full" role="status" aria-label="Output volume"
    initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,transition:{duration:0.1}}} transition={{duration:reduced?0.1:0.16,delay:reduced?0:0.1}}
    onWheel={e=>{if(!e.deltaY)return;e.stopPropagation();const now=performance.now();const current=now-wheel.current.at<300?wheel.current.value:volume;const next=Math.max(0,Math.min(1,current+(e.deltaY<0?0.03:-0.03)));wheel.current={value:next,at:now};onWheelVolume(next);}}>
    <motion.div className="absolute inset-y-0 flex items-center gap-2.5" style={side==='left'?{left:18,right:76}:{left:76,right:18}}
      initial={{x:reduced?0:side==='left'?16:-16,scale:reduced?1:0.92}} animate={{x:0,scale:1}} exit={{x:reduced?0:side==='left'?12:-12,scale:reduced?1:0.94,transition:{duration:0.12}}} transition={reduced?{duration:0.1}:{...contentSpring,delay:0.06}}>
      <span style={{color:accentColor}}>{volume===0?<VolumeX size={17}/>:<Volume2 size={17}/>}</span>
      <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold isla-tabular mb-1.5">{Math.round(volume*100)}%</div>
        <div className="h-1 overflow-hidden rounded-full" style={{background:'var(--isla-bg-active)'}}><motion.div className="h-full rounded-full" style={{background:accentColor,transformOrigin:'left'}} initial={false} animate={{scaleX:volume}} transition={{duration:reduced?0:0.12}}/></div>
      </div>
    </motion.div>
  </motion.div>;
}
