import { describe, expect, it } from 'vitest';
import * as interaction from './interaction';

describe('compact orb geometry and activation', () => {
  it('rests as a circle while other pill sizes keep their layout', () => {
    expect(interaction.getIslandGeometry('compact', 0, 0, false, false, false)).toEqual({ x:0,y:0,width:60,height:60,radius:30 });
    expect(interaction.getIslandGeometry('default', 0, 0, false, false, false).width).toBe(260);
  });
  it('keeps the orb fixed and places controls on the available side', () => {
    const left = interaction.getCompactLayout(0,0,true);
    expect(left).toMatchObject({x:0,y:0,width:224,height:60,orbX:0,controlsX:72,side:'right'});
    const right = interaction.getCompactLayout(352,328,true);
    expect(right).toMatchObject({x:188,y:328,width:224,height:60,orbX:164,controlsX:0,side:'left'});
    expect(right.x+right.orbX).toBe(352);
  });
  it('keeps both surfaces inside the canvas for every horizontal anchor', () => {
    for(let x=0;x<=352;x++) {
      const g=interaction.getCompactLayout(x,0,true);
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x+g.width).toBeLessThanOrEqual(412);
      expect(g.x+g.orbX).toBe(x);
    }
  });
  it('toggles compact controls while other sizes directly expand', () => {
    expect(interaction.compactActivation('compact',false)).toBe('reveal');
    expect(interaction.compactActivation('compact',true)).toBe('collapse');
    expect(interaction.compactActivation('default',false)).toBe('expand');
    expect(interaction.compactActivation('large',false)).toBe('expand');
  });
  it('clamps real progress and rejects invalid timing values', () => {
    expect(interaction.playbackFraction(60,240)).toBe(0.25);
    expect(interaction.playbackFraction(-3,240)).toBe(0);
    expect(interaction.playbackFraction(300,240)).toBe(1);
    for(const [p,d] of [[0,0],[NaN,240],[60,Infinity],[Infinity,240]]) expect(interaction.playbackFraction(p,d)).toBe(0);
  });
});
