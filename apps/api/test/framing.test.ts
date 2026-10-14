import { describe, expect, it } from 'vitest';
import { LineFramer } from '../src/feed/framing';

describe('LineFramer', () => {
  it('passes whole lines straight through', () => {
    expect(new LineFramer().push('{"a":1}')).toEqual({ complete: '{"a":1}', abandoned: null });
  });

  it('rejoins an object split across two lines', () => {
    const framer = new LineFramer();
    expect(framer.push('{"a":')).toEqual({ complete: null, abandoned: null });
    expect(framer.push('1}')).toEqual({ complete: '{"a":1}', abandoned: null });
  });

  it('gives up on a fragment the next line does not complete', () => {
    const framer = new LineFramer();
    framer.push('{"a":');
    expect(framer.push('{"b":2}')).toEqual({ complete: '{"b":2}', abandoned: '{"a":' });
  });
});
