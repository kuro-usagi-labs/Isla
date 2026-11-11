import {expect,it} from 'vitest';
import {playerGather} from './player-gather';
it('keeps an expanded canvas at its original size and converges at the artwork center',()=>{
  expect(playerGather(412,268)).toMatchObject({scale:1,x:0,y:0,opacity:1});
  for(const height of [268,388]) {
    const end=playerGather(60,height);
    expect(206+end.x).toBe(30);expect(height/2+end.y).toBe(30);
    expect(end.opacity).toBe(0);
    const mid=playerGather(236,height);
    expect(mid.scale).toBeCloseTo(0.56);expect(mid.opacity).toBe(1);
  }
});
