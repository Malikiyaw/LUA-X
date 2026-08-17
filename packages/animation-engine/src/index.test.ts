import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addKeyframe,
  addMarker,
  createAnimationClip,
  interpolateNumber,
  validateAnimationClip
} from './index.js';

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

test('keeps keyframes and markers sorted', () => {
  let clip = createAnimationClip({ name: 'A', action: 'A', duration: 2 });
  clip = addKeyframe(clip, { time: 1, joint: 'Torso', transform: {} });
  clip = addKeyframe(clip, { time: 0, joint: 'Root', transform: {} });
  clip = addMarker(clip, { name: 'Hit', time: 1, kind: 'gameplay' });
  assert.equal(clip.keyframes[0]?.time, 0);
  assert.equal(clip.markers[0]?.name, 'Hit');
});

test('rejects out-of-range timeline data', () => {
  const clip = createAnimationClip({ name: 'A', action: 'A', duration: 1 });
  const invalid = addKeyframe(clip, { time: 2, joint: 'Root', transform: {} });
  const result = validateAnimationClip(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.code === 'KEYFRAME_OUT_OF_RANGE'));
});

test('detects duplicate markers without making them fatal', () => {
  let clip = createAnimationClip({ name: 'A', action: 'A', duration: 1 });
  clip = addMarker(clip, { name: 'Hit', time: 0.5, kind: 'gameplay' });
  clip = addMarker(clip, { name: 'Hit', time: 0.7, kind: 'gameplay' });
  const result = validateAnimationClip(clip);
  assert.equal(result.valid, true);
  assert.ok(result.issues.some(issue => issue.code === 'DUPLICATE_MARKER'));
});

test('supports interpolation modes', () => {
  assert.equal(interpolateNumber(0, 10, 0.5, 'linear'), 5);
  assert.equal(interpolateNumber(0, 10, 0.5, 'constant'), 0);
  assert.equal(interpolateNumber(0, 10, 0.5, 'cubic'), 5);
});
