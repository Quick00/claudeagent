import { emptyTurnMessage } from '@/lib/empty-turn';

describe('emptyTurnMessage', () => {
  it('explains a turn that hit the step limit', () => {
    expect(emptyTurnMessage('error_max_turns')).toMatch(/narrower question/);
  });

  it('falls back to a generic message for any other or missing result', () => {
    expect(emptyTurnMessage('error_during_execution')).toMatch(/try again/);
    expect(emptyTurnMessage(null)).toMatch(/try again/);
  });
});
