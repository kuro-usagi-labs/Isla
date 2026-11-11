import { expect,it } from 'vitest';
import { compactFlowReducer as step,initialCompactFlow as orb } from './compact-flow';
it('rejoins controls into artwork before expanding the player',()=>{
  const controls=step(orb,{type:'reveal'});
  const merging=step(controls,{type:'request',intent:'expand'});
  expect(merging).toEqual({phase:'merging',pending:'expand'});
  expect(step(merging,{type:'settled'})).toEqual({phase:'expand',pending:null});
});
it('merges controls before volume, while a resting orb opens volume directly',()=>{
  expect(step(orb,{type:'request',intent:'volume'})).toEqual({phase:'volume',pending:null});
  const merging=step(step(orb,{type:'reveal'}),{type:'request',intent:'volume'});
  expect(merging.phase).toBe('merging');
  expect(step(merging,{type:'settled'}).phase).toBe('volume');
});
it('collapses volume into artwork before expanding and ignores repeat clicks during merge',()=>{
  const merging=step({phase:'volume',pending:null},{type:'request',intent:'expand'});
  expect(merging.phase).toBe('merging');
  expect(step(merging,{type:'reveal'})).toBe(merging);
  expect(step(merging,{type:'request',intent:'volume'})).toBe(merging);
  expect(step(merging,{type:'reset'})).toEqual(orb);
});
