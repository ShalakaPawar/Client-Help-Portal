import { missingVideoReason } from './processing.processor';

describe('missingVideoReason', () => {
  it('says how to fix it when the recorder could not write to the recordings folder', () => {
    const reason = missingVideoReason([
      { kind: 'VOICE', error: null },
      { kind: 'COMPOSITE', error: 'Local upload failed: mkdir /data/recordings/abc: no such file or directory' },
    ]);
    expect(reason).toMatch(/could not save files to data\/recordings/);
    expect(reason).toMatch(/docker compose up -d egress/);
  });

  it('passes other recorder errors through', () => {
    expect(missingVideoReason([{ kind: 'COMPOSITE', error: 'pipeline crashed' }])).toBe('The recorder failed: pipeline crashed');
  });

  it('keeps the plain message when the recorder reported nothing', () => {
    expect(missingVideoReason([{ kind: 'COMPOSITE', error: null }])).toBe('The video recording is missing');
  });
});
