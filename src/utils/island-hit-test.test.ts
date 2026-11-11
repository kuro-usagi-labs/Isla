import { afterEach, describe, expect, it, vi } from 'vitest';
import { containsIslandPoint, islandOwnsPointer, measureIslandHitGeometry } from './island-hit-test';

function region(x: number, y: number, width: number, options: {inert?:boolean;opacity?:string;padding?:string} = {}) {
  return { getBoundingClientRect:()=>({x,y,width,height:width}),offsetWidth:60,
    dataset:{hitSlop:options.padding??'0'},closest:()=>options.inert?{}:null,
    styleForTest:{borderTopLeftRadius:'30px',display:'block',visibility:'visible',opacity:options.opacity??'1'} };
}
function shell(nodes: ReturnType<typeof region>[]) {
  vi.stubGlobal('getComputedStyle',(node: ReturnType<typeof region>)=>node.styleForTest);
  return {getBoundingClientRect:()=>({x:48,y:48,width:412,height:268}),offsetWidth:412,
    dataset:{islandExpanded:'false'},querySelectorAll:()=>nodes,
    styleForTest:{borderTopLeftRadius:'28px'} } as unknown as HTMLElement;
}
afterEach(()=>vi.unstubAllGlobals());

describe('visible island hit regions',()=>{
  it('cannot claim a Windows click in the former expanded footprint',()=>{
    const node=shell([region(48,48,60,{padding:'4'})]);
    expect(islandOwnsPointer(node,78,78)).toBe(true);
    expect(islandOwnsPointer(node,300,240)).toBe(false);
    expect(islandOwnsPointer(node,44,44)).toBe(false);
  });
  it('discards inert, zero-size and transparent regions instead of invalidating the whole packet',()=>{
    const node=shell([region(48,48,60),region(120,48,0),region(120,48,60,{inert:true}),region(120,48,60,{opacity:'0'})]);
    expect(measureIslandHitGeometry(node)?.regions).toHaveLength(1);
  });
  it('keeps circular hit slop aligned with the pulsed visual scale',()=>{
    const geometry=measureIslandHitGeometry(shell([region(100,200,75,{padding:'4'})]))!;
    expect(geometry.regions[0]).toEqual({x:95,y:195,width:85,height:85,radius:42.5});
    expect(containsIslandPoint(geometry.regions[0],137.5,237.5)).toBe(true);
    expect(containsIslandPoint(geometry.regions[0],95,195)).toBe(false);
  });
});
