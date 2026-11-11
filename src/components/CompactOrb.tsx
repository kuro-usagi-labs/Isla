import { useEffect, useId, useRef, type ComponentProps } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type Transition } from 'motion/react';
import { Pause, Play, SkipBack, SkipForward, Maximize2 } from 'lucide-react';
import type { CompactPill } from './CompactPill';
import { ArtworkTile } from './ArtworkTile';
import { islaBridge } from '../services/bridge';
import { playbackFraction } from '../utils/interaction';
import { contentSpring, splitSpring, transportSpring } from '../utils/motion';
import { liquidCompactFrame } from '../utils/liquid-island';

export type CompactOrbProps = Pick<ComponentProps<typeof CompactPill>, 'player'|'settings'|'accentColor'|'isExpanded'|'onExpand'|'onTogglePlayPause'|'onNextTrack'|'onPreviousTrack'|'onWheelVolume'|'onPressChange'|'onControlHoverChange'> & {
  controls: boolean; orbX: number; controlsX: number; side: string;
  geometryTransition?: Transition; onGeometryChange?: () => void;
  volumeMorph?: boolean;
  onOpenPlayer: () => void;
};

export function CompactOrb({ player,settings,accentColor,isExpanded,controls,side,volumeMorph=false,
  onExpand,onOpenPlayer,onTogglePlayPause,onNextTrack,onPreviousTrack,onWheelVolume,onPressChange,onControlHoverChange,onGeometryChange }: CompactOrbProps) {
  const origin=useRef<{x:number;y:number;dragged:boolean}|null>(null);
  const suppressClick=useRef(false);
  const wheel=useRef({value:player.volume,at:0});
  const track=player.currentTrack;
  const reduced=settings.reducedMotion;
  const progress=playbackFraction(player.positionSecs,player.durationSecs);
  const spring=reduced ? {duration:0.1} : contentSpring;
  const release=()=>{origin.current=null;onPressChange?.(false);};
  const canPlay=Boolean(track)||player.queue.length>0;
  const gradientId=useId().replace(/:/g,'');
  const reveal=useMotionValue(controls?1:0);
  const shape=useTransform(reveal,p=>liquidCompactFrame(p,side==='left'?'left':'right'));
  const path=useTransform(shape,f=>f.path);
  const skinWidth=useTransform(reveal,p=>60+164*Math.max(0,Math.min(1,p)));
  const skinViewBox=useTransform(skinWidth,w=>`0 0 ${w} 60`);
  const controllerX=useTransform(shape,f=>f.controlsX);
  const controllerWidth=useTransform(shape,f=>f.controlsWidth);
  // The foreground follows the same physical progress as its liquid surface.
  // It stays mounted so rapid reversals retain position and spring velocity.
  const contentScale=useTransform(reveal,p=>0.16+0.84*Math.max(0,Math.min(1,p)));
  const contentOpacity=useTransform(reveal,p=>Math.max(0,Math.min(1,(p-0.08)/0.5)));
  useEffect(()=>{
    const animation=animate(reveal,controls?1:0,{...(reduced?{duration:0.1}:splitSpring),onUpdate:()=>onGeometryChange?.(),onComplete:()=>onGeometryChange?.()});
    return()=>animation.stop();
  },[controls,reduced,reveal,onGeometryChange]);
  useEffect(() => {
    if (!controls || isExpanded) onControlHoverChange?.(false);
    return () => { onControlHoverChange?.(false); };
  },[controls,isExpanded,onControlHoverChange]);
  useEffect(() => () => { onPressChange?.(false); },[onPressChange]);
  return <motion.div className="absolute inset-0 z-20 pointer-events-none" inert={isExpanded} aria-hidden={isExpanded}
    initial={false} animate={{opacity:isExpanded?0:1}} transition={{duration:0.12,delay:isExpanded||reduced?0:0.18}}>
    <motion.svg data-liquid-surface aria-hidden="true" className="isla-liquid-skin absolute top-0 pointer-events-none" style={side==='left'?{right:0}:{left:0}} width={skinWidth} height="60" viewBox={skinViewBox} animate={{opacity:volumeMorph?0:1}} transition={{duration:0.12}}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--isla-liquid-top)"/><stop offset="1" stopColor="var(--isla-liquid-bottom)"/></linearGradient></defs>
      <motion.path d={path} fill={`url(#${gradientId})`} stroke="var(--isla-border-ring)" strokeWidth="0.7"/>
    </motion.svg>
    <motion.button type="button" data-compact-orb data-island-hit-region data-hit-slop="4"
      aria-label={controls||volumeMorph?'Hide playback controls':'Show playback controls'} aria-expanded={controls || isExpanded}
      title={track ? `${track.title} · ${track.artist}` : 'Isla · Show playback controls'}
      className="absolute top-0 z-20 w-[60px] h-[60px] rounded-full cursor-pointer select-none pointer-events-auto grid place-items-center"
      style={side==='left'?{right:0}:{left:0}}
      onPointerDown={(e)=>{
        if(e.button!==0) return;
        suppressClick.current=false;
        origin.current={x:e.clientX,y:e.clientY,dragged:false};
        e.currentTarget.setPointerCapture(e.pointerId);onPressChange?.(true);
      }}
      onPointerMove={(e)=>{
        const p=origin.current;
        if(!p||p.dragged||Math.hypot(e.clientX-p.x,e.clientY-p.y)<5) return;
        p.dragged=true;suppressClick.current=true;onPressChange?.(false);
        void islaBridge.startWindowDragging();
      }}
      onPointerUp={(e)=>{release();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={release} onLostPointerCapture={release}
      onClick={(e)=>{if(e.detail===0||!suppressClick.current)onExpand();suppressClick.current=false;}}
      onWheel={(e)=>{
        if(!e.deltaY)return;e.stopPropagation();
        const now=performance.now();
        const current=now-wheel.current.at<300?wheel.current.value:player.isMuted?0:player.volume;
        const value=Math.max(0,Math.min(1,current+(e.deltaY<0?0.03:-0.03)));
        wheel.current={value,at:now};onWheelVolume(value);
      }}>
      <span aria-hidden="true" className="absolute -inset-1 rounded-full pointer-events-auto" />
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={track?.id??'empty'} className="absolute inset-[8px] grid place-items-center pointer-events-none"
          initial={reduced?{opacity:0}:{opacity:0,scale:0.82,filter:'blur(3px)'}} animate={{opacity:1,scale:reduced?1:volumeMorph?0.94:controls?1.035:1,filter:'blur(0px)'}} exit={{opacity:0,scale:reduced?1:0.9}} transition={spring}>
          <ArtworkTile title={track?.title??'Isla'} artworkDataUrl={track?.artworkDataUrl} dominantColor={track?.dominantColor??accentColor} sizeClass="w-11 h-11" roundedClass="rounded-full" iconSize={20}/>
        </motion.span>
      </AnimatePresence>
      <svg className="absolute inset-[3px] w-[54px] h-[54px] pointer-events-none -rotate-90" viewBox="0 0 54 54"
        role="progressbar" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}>
        <circle cx="27" cy="27" r="25" fill="none" stroke="var(--isla-divider)" strokeWidth="2"/>
        <motion.circle cx="27" cy="27" r="25" fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" pathLength={1}
          strokeDasharray="1 1" initial={false} animate={{strokeDashoffset:1-progress}} transition={{duration:reduced?0:0.15,ease:'linear'}}/>
      </svg>
    </motion.button>
    <div className="absolute inset-0 pointer-events-none" inert={!controls} aria-hidden={!controls}>
      <motion.div data-island-hit-region role="group" aria-label="Playback controls"
        className="isla-satellite absolute top-0 z-10 rounded-full pointer-events-auto"
        style={{height:60,left:controllerX,width:controllerWidth,opacity:contentOpacity}}
        onMouseEnter={()=>onControlHoverChange?.(true)} onMouseLeave={()=>onControlHoverChange?.(false)}>
        <motion.div className="absolute inset-y-0 w-[152px] flex items-center justify-center gap-0.5 px-1.5" style={{left:'50%',marginLeft:-76,scale:reduced?1:contentScale,transformOrigin:'center'}}>
        <motion.button type="button" aria-label="Previous track" title="Previous track" className="isla-orb-transport" onClick={onPreviousTrack} disabled={!track} whileTap={reduced?undefined:{scale:0.9}} transition={transportSpring}><SkipBack size={17} fill="currentColor"/></motion.button>
        <motion.button type="button" data-pill-play disabled={!canPlay} aria-label={player.isPlaying?'Pause':'Play'} title={player.isPlaying?'Pause':'Play'} className="isla-orb-transport isla-orb-play" onClick={onTogglePlayPause} whileTap={reduced?undefined:{scale:0.92}} transition={transportSpring}>
          <AnimatePresence initial={false} mode="popLayout"><motion.span key={player.isPlaying?'pause':'play'} className="flex" initial={{opacity:0,scale:reduced?1:0.75}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:reduced?1:0.75}} transition={{duration:0.12}}>{player.isPlaying?<Pause size={19} fill="currentColor" strokeWidth={0}/>:<Play size={19} fill="currentColor" strokeWidth={0} className="ml-0.5"/>}</motion.span></AnimatePresence>
        </motion.button>
        <motion.button type="button" aria-label="Next track" title="Next track" className="isla-orb-transport" onClick={onNextTrack} disabled={!track} whileTap={reduced?undefined:{scale:0.9}} transition={transportSpring}><SkipForward size={17} fill="currentColor"/></motion.button>
        <motion.button type="button" aria-label="Expand music player" title="Expand player" className="isla-orb-transport isla-orb-expand" onClick={onOpenPlayer} whileTap={reduced?undefined:{scale:0.9}} transition={transportSpring}><Maximize2 size={14}/></motion.button>
        </motion.div>
      </motion.div>
    </div>
  </motion.div>;
}
