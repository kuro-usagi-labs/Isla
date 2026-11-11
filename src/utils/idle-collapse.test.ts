import {afterEach,expect,it,vi} from 'vitest';
import {createIdleCollapse} from './idle-collapse';

afterEach(()=>vi.useRealTimers());
it('returns to rest after inactivity, restarting on actual interaction',()=>{
  vi.useFakeTimers(); let collapsed=0;
  const idle=createIdleCollapse(()=>collapsed++);
  idle.arm(2400);vi.advanceTimersByTime(2000);idle.touch();
  vi.advanceTimersByTime(2000);expect(collapsed).toBe(0);
  vi.advanceTimersByTime(400);expect(collapsed).toBe(1);
  vi.advanceTimersByTime(5000);expect(collapsed).toBe(1);
});
it('does not collapse a held slider, including across state changes',()=>{
  vi.useFakeTimers();let collapsed=0;const idle=createIdleCollapse(()=>collapsed++);
  idle.arm(2400);idle.hold();idle.arm(1100);vi.advanceTimersByTime(5000);
  expect(collapsed).toBe(0);idle.release();vi.advanceTimersByTime(1099);
  expect(collapsed).toBe(0);vi.advanceTimersByTime(1);expect(collapsed).toBe(1);
});
it('cancels stale callbacks on reset and disposal',()=>{
  vi.useFakeTimers();let collapsed=0;const idle=createIdleCollapse(()=>collapsed++);
  idle.arm(1100);vi.advanceTimersByTime(500);idle.arm(2400);
  vi.advanceTimersByTime(600);expect(collapsed).toBe(0);
  idle.arm(null);idle.touch();vi.advanceTimersByTime(4000);expect(collapsed).toBe(0);
  idle.arm(2400);idle.dispose();vi.advanceTimersByTime(4000);expect(collapsed).toBe(0);
});
