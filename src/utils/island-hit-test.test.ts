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
    closest:()=>null,parentElement:null,
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
  it('does not fall back to the oversized layout shell when every region is inactive',()=>{
    const node=shell([region(48,48,60,{inert:true})]);
    expect(measureIslandHitGeometry(node)?.regions).toEqual([]);
    expect(islandOwnsPointer(node,300,240)).toBe(false);
  });
  it('captures a shell rectangle only when it explicitly paints a visible surface',()=>{
    const node=shell([]);
    expect(islandOwnsPointer(node,300,240)).toBe(false);
    node.dataset.islandSurface='true';
    expect(islandOwnsPointer(node,300,240)).toBe(true);
  });
  it('adds only the menu rectangle, leaving its transparent backdrop unclaimed',()=>{
    const node=shell([region(48,48,60)]);
    const menu=region(200,48,120);
    const geometry=measureIslandHitGeometry(node,[menu as unknown as HTMLElement])!;
    expect(geometry.regions.some(r=>containsIslandPoint(r,250,100))).toBe(true);
    expect(geometry.regions.some(r=>containsIslandPoint(r,150,180))).toBe(false);
  });
});
