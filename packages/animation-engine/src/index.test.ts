import test from 'node:test';
import assert from 'node:assert/strict';
import { addKeyframe, createAnimationClip, validateAnimationClip } from './index.js';

test('creates a normalized animation clip', () => {
  const clip = createAnimationClip({ name: ' Sword Slash ', action: 'Fast slash', duration: 2 });
  assert.equal(clip.name, 'Sword Slash');
  assert.equal(clip.duration, 2);
  assert.equal(clip.rig, 'unknown');
  assert.equal(clip.looped, false);
});

test('clamps invalid requested duration', () => {
  assert.equal(createAnimationClip({ name: 'A', action: 'A', duration: -2 }).duration, 0.05);
  assert.equal(createAnimationClip({ name: 'A', action: 'A', duration: 100 }).duration, 60);
});

test('keeps keyframes in the clip', () => {
  let clip = createAnimationClip({ name: 'A', action: 'A', duration: 2 });
  clip = addKeyframe(clip, { time: 1, joints: { Torso: {} } });
  clip = addKeyframe(clip, { time: 0, joints: { Root: {} } });
  assert.equal(clip.keyframes.length, 2);
  assert.equal(clip.keyframes[0]?.time, 1);
  assert.equal(clip.keyframes[1]?.time, 0);
});

test('rejects out-of-range timeline data', () => {
  const clip = createAnimationClip({ name: 'A', action: 'A', duration: 1 });
  const invalid = addKeyframe(clip, { time: 2, joints: { Root: {} } });
  const result = validateAnimationClip(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.message.includes('outside the clip duration')));
});

test('accepts a valid empty clip', () => {
  const clip = createAnimationClip({ name: 'A', action: 'A', duration: 1 });
  const result = validateAnimationClip(clip);
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});
