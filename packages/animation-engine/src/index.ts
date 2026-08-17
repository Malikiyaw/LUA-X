export type AnimationIntent = { name: string; action: string; rig?: string; duration?: number; looped?: boolean; style?: string };
export type PoseKeyframe = { time: number; joints: Record<string, unknown> };
export type AnimationClip = { id: string; name: string; rig: string; duration: number; looped: boolean; keyframes: PoseKeyframe[]; markers: string[]; metadata: { intent: string; style?: string; generatedAt: string } };
export type AnimationValidationIssue = { severity: 'error' | 'warning'; message: string };
export type AnimationValidationResult = { valid: boolean; issues: AnimationValidationIssue[] };
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export function createAnimationClip(intent: AnimationIntent, now = new Date()): AnimationClip {
  const duration = clamp(intent.duration ?? 1, 0.05, 60); const rig = intent.rig ?? 'unknown'; const slug = intent.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation';
  return { id: `${slug}-${now.getTime()}`, name: intent.name.trim() || 'Untitled Animation', rig, duration, looped: intent.looped ?? false, keyframes: [], markers: [], metadata: { intent: intent.action.trim(), ...(intent.style?.trim() ? { style: intent.style.trim() } : {}), generatedAt: now.toISOString() } };
}
export function addKeyframe(clip: AnimationClip, keyframe: PoseKeyframe): AnimationClip { return { ...clip, keyframes: [...clip.keyframes, keyframe] }; }
export function validateAnimationClip(clip: AnimationClip): AnimationValidationResult { const issues: AnimationValidationIssue[] = []; if (!clip.name.trim()) issues.push({ severity: 'error', message: 'Animation name is required.' }); if (clip.duration <= 0) issues.push({ severity: 'error', message: 'Animation duration must be positive.' }); if (clip.keyframes.some((keyframe) => keyframe.time < 0 || keyframe.time > clip.duration)) issues.push({ severity: 'error', message: 'Keyframe time is outside the clip duration.' }); return { valid: issues.every((issue) => issue.severity !== 'error'), issues }; }
