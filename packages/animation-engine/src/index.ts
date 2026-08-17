export type RigType = 'R6' | 'R15' | 'unknown';
export type Interpolation = 'linear' | 'constant' | 'cubic';
export type AnimationMarkerKind = 'gameplay' | 'fx' | 'audio' | 'custom';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PoseTransform {
  position?: Vector3Like;
  rotation?: QuaternionLike;
}

export interface PoseKeyframe {
  time: number;
  joint: string;
  transform: PoseTransform;
  interpolation?: Interpolation;
}

export interface AnimationMarker {
  name: string;
  time: number;
  kind: AnimationMarkerKind;
  payload?: string;
}

export interface AnimationClip {
  id: string;
  name: string;
  rig: RigType;
  duration: number;
  looped: boolean;
  keyframes: PoseKeyframe[];
  markers: AnimationMarker[];
  metadata: {
    intent: string;
    style?: string;
    generatedAt: string;
  };
}

export interface AnimationIntent {
  name: string;
  action: string;
  rig?: RigType;
  duration?: number;
  looped?: boolean;
  style?: string;
}

export interface AnimationValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export interface AnimationValidationResult {
  valid: boolean;
  issues: AnimationValidationIssue[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function createAnimationClip(intent: AnimationIntent, now = new Date()): AnimationClip {
  const duration = clamp(intent.duration ?? 1, 0.05, 60);
  const rig = intent.rig ?? 'unknown';
  const slug = intent.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation';

  return {
    id: `${slug}-${now.getTime()}`,
    name: intent.name.trim() || 'Untitled Animation',
    rig,
    duration,
    looped: intent.looped ?? false,
    keyframes: [],
    markers: [],
    metadata: {
      intent: intent.action.trim(),
      style: intent.style?.trim() || undefined,
      generatedAt: now.toISOString()
    }
  };
}

export function addKeyframe(clip: AnimationClip, keyframe: PoseKeyframe): AnimationClip {
  const next = {
    ...clip,
    keyframes: [...clip.keyframes, keyframe]
  };
  return sortClip(next);
}

export function addMarker(clip: AnimationClip, marker: AnimationMarker): AnimationClip {
  return sortClip({ ...clip, markers: [...clip.markers, marker] });
}

export function sortClip(clip: AnimationClip): AnimationClip {
  return {
    ...clip,
    keyframes: [...clip.keyframes].sort((a, b) => a.time - b.time || a.joint.localeCompare(b.joint)),
    markers: [...clip.markers].sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))
  };
}

export function validateAnimationClip(clip: AnimationClip): AnimationValidationResult {
  const issues: AnimationValidationIssue[] = [];
  if (!clip.name.trim()) issues.push({ severity: 'error', code: 'EMPTY_NAME', message: 'Animation name is required.' });
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) issues.push({ severity: 'error', code: 'INVALID_DURATION', message: 'Duration must be a positive finite number.', path: 'duration' });

  for (const [index, keyframe] of clip.keyframes.entries()) {
    if (!Number.isFinite(keyframe.time) || keyframe.time < 0 || keyframe.time > clip.duration) {
      issues.push({ severity: 'error', code: 'KEYFRAME_OUT_OF_RANGE', message: 'Keyframe time must be inside the clip duration.', path: `keyframes.${index}.time` });
    }
    if (!keyframe.joint.trim()) issues.push({ severity: 'error', code: 'EMPTY_JOINT', message: 'Keyframe joint is required.', path: `keyframes.${index}.joint` });
  }

  for (const [index, marker] of clip.markers.entries()) {
    if (!Number.isFinite(marker.time) || marker.time < 0 || marker.time > clip.duration) {
      issues.push({ severity: 'error', code: 'MARKER_OUT_OF_RANGE', message: 'Marker time must be inside the clip duration.', path: `markers.${index}.time` });
    }
    if (!marker.name.trim()) issues.push({ severity: 'error', code: 'EMPTY_MARKER_NAME', message: 'Marker name is required.', path: `markers.${index}.name` });
  }

  const markerNames = new Set<string>();
  for (const marker of clip.markers) {
    if (markerNames.has(marker.name)) issues.push({ severity: 'warning', code: 'DUPLICATE_MARKER', message: `Marker '${marker.name}' appears more than once.` });
    markerNames.add(marker.name);
  }

  if (clip.looped && clip.duration < 0.1) {
    issues.push({ severity: 'warning', code: 'SHORT_LOOP', message: 'Very short loops may produce unstable-looking motion.' });
  }

  return { valid: !issues.some(issue => issue.severity === 'error'), issues };
}

export function interpolateNumber(a: number, b: number, alpha: number, mode: Interpolation = 'linear'): number {
  const t = clamp(alpha, 0, 1);
  if (mode === 'constant') return a;
  if (mode === 'cubic') {
    const smooth = t * t * (3 - 2 * t);
    return a + (b - a) * smooth;
  }
  return a + (b - a) * t;
}
