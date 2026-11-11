import { describe,expect,it } from 'vitest';
import * as liquid from './liquid-island';

describe('reference liquid island shape',()=>{
  it('starts as one 60px circle and finishes as equal-height separate surfaces',()=>{
    const start=liquid.liquidCompactFrame(0,'right');
    const end=liquid.liquidCompactFrame(1,'right');
    expect(start).toMatchObject({orbX:0,controlsX:0,controlsWidth:60});
    expect(end).toMatchObject({orbX:0,controlsX:72,controlsWidth:152});
    expect(end.path.match(/M/g)).toHaveLength(2);
  });
  it('has a connected curved neck before separating and mirrors it to the left',()=>{
    const right=liquid.liquidCompactFrame(0.89,'right');
    const left=liquid.liquidCompactFrame(0.96,'left');
    expect(right.path).toContain('C');
    expect(left.path).toContain('C');
    expect(right.path.match(/M/g)).toHaveLength(1);
    expect(liquid.liquidCompactFrame(1,'left')).toMatchObject({orbX:164,controlsX:0,controlsWidth:152});
  });
  it('keeps spring overshoot and invalid inputs finite without inverted shapes',()=>{
    for(const p of [-0.1,0,0.4,0.7,0.9,1,1.08,NaN]) for(const side of ['left','right'] as const){
      const f=liquid.liquidCompactFrame(p,side);
      expect(f.path).not.toMatch(/NaN|Infinity/);
      expect(f.controlsWidth).toBeGreaterThanOrEqual(60);
      expect(f.controlsWidth).toBeLessThanOrEqual(152);
    }
  });
});
