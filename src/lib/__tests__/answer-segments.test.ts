import { createAnswerSegments, isLeakyNote } from '@/lib/answer-segments';

describe('isLeakyNote', () => {
  // Notes seen in production, each written just before a tool call.
  it.each([
    'Good — 16310549 is Eventinsight (PHP/composer). Let me search there for workshop/theme/round selection constraints.',
    'Found it: MultiSessionSelectComponent and GenericMultiLayeredSessionSelectComponent look most relevant.',
    '"SessionTagLimit.php" — exactly what we need.',
    'OK, repo 16310549 = Eventinsight. Let me search within it specifically.',
    'Checking `limits` next.',
    'Let me look at getSessionLimit first.',
  ])('flags %p', (note) => {
    expect(isLeakyNote(note)).toBe(true);
  });

  it.each([
    'Looking into how workshop choices are limited…',
    'Checking how the HubSpot contact sync handles this.',
    'Good, that confirms it.',
  ])('lets %p through', (note) => {
    expect(isLeakyNote(note)).toBe(false);
  });
});

describe('createAnswerSegments', () => {
  function setup() {
    const frames: Array<Record<string, unknown>> = [];
    const segments = createAnswerSegments({
      send: (data) => frames.push(JSON.parse(data)),
      close: () => {},
    });
    return { frames, segments };
  }

  it('retracts a leaky note at the tool call and never keeps it', () => {
    const { frames, segments } = setup();
    segments.append('OK, repo 16310549 = Eventinsight.');
    segments.closeAtTool();
    segments.append('Short answer: yes.');
    segments.flushOpen();

    expect(frames.map((f) => f.type)).toEqual(['text', 'text_retract', 'text']);
    expect(segments.contents()).toEqual(['Short answer: yes.']);
    expect(segments.droppedNotes).toBe(1);
  });

  it('keeps a clean note as its own bubble', () => {
    const { frames, segments } = setup();
    segments.append('Looking into it.');
    segments.closeAtTool();
    segments.append('Short answer: yes.');
    segments.flushOpen();

    expect(frames.map((f) => f.type)).toEqual(['text', 'text_break', 'text']);
    expect(segments.contents()).toEqual(['Looking into it.', 'Short answer: yes.']);
  });

  it('never drops the final answer, however technical it reads', () => {
    const { segments } = setup();
    segments.append('The repository sync runs every 10 minutes.');
    segments.flushOpen();

    expect(segments.contents()).toEqual(['The repository sync runs every 10 minutes.']);
  });
});
