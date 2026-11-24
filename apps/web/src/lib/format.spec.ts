import { activeSegmentIndex, formatClock, seekSeconds } from './format';

const segs = [{ startMs: 1000 }, { startMs: 4000 }, { startMs: 9000 }];

describe('click-to-seek and transcript highlighting', () => {
  it('a transcript line jumps the video to its start (seconds)', () => {
    expect(seekSeconds({ startMs: 65_500 })).toBe(65.5);
    expect(seekSeconds({ startMs: -10 })).toBe(0);
  });

  it('highlights the line being spoken at the current video time', () => {
    expect(activeSegmentIndex(segs, 0)).toBe(-1); // before the first line
    expect(activeSegmentIndex(segs, 1000)).toBe(0);
    expect(activeSegmentIndex(segs, 5000)).toBe(1);
    expect(activeSegmentIndex(segs, 60_000)).toBe(2);
    expect(activeSegmentIndex([], 5000)).toBe(-1);
  });

  it('formats clock times', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(0)).toBe('0:00');
  });
});
