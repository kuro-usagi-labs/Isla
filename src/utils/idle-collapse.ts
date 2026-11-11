/** One deadline for the whole island. Playback ticks and hover never extend it. */
export function createIdleCollapse(onIdle:()=>void) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  let delay:number|null=null;
  let held=false;
  const cancel=()=>{clearTimeout(timer);timer=undefined;};
  const touch=()=>{
    cancel();
    if(delay===null||held)return;
    timer=setTimeout(()=>{timer=undefined;delay=null;onIdle();},delay);
  };
  return {
    arm(next:number|null){delay=next;touch();},
    touch,
    hold(){held=true;cancel();},
    release(){if(!held)return;held=false;touch();},
    dispose(){delay=null;held=false;cancel();},
  };
}
