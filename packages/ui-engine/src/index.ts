export type UIState = 'default' | 'hover' | 'pressed' | 'disabled' | 'loading' | 'success' | 'error';
export type LayoutKind = 'absolute' | 'list' | 'grid' | 'page';
export type UIComponentKind = 'screen' | 'frame' | 'text' | 'button' | 'image' | 'input' | 'scroll' | 'template';

export interface UISize { scale: number; offset: number }
export interface UIPosition { x: UISize; y: UISize }
export interface UIStyle {
  width?: UISize; height?: UISize; position?: UIPosition;
  spacing?: number; padding?: number; cornerRadius?: number;
  transparency?: number; textSize?: number; font?: string;
  colorToken?: string;
}
export interface UIStateSpec { state: UIState; style?: UIStyle; enabled?: boolean; feedback?: string }
export interface UIComponent {
  id: string; kind: UIComponentKind; name: string; parentId?: string;
  layout?: LayoutKind; style?: UIStyle; states?: UIStateSpec[];
  children?: string[]; action?: { type: string; payload?: Record<string, unknown> };
}
export interface UIScreenSpec {
  id: string; name: string; rootId: string; components: UIComponent[];
  theme: { tokens: Record<string, string | number> };
  responsive: { minWidth?: number; maxWidth?: number; rules: string[] };
}

export interface UIValidationIssue { severity: 'error' | 'warning'; code: string; message: string; componentId?: string }

export function createScreen(input: Omit<UIScreenSpec, 'components'> & { components?: UIComponent[] }): UIScreenSpec {
  return { ...input, components: input.components ?? [] };
}

export function validateScreen(screen: UIScreenSpec): UIValidationIssue[] {
  const issues: UIValidationIssue[] = [];
  if (!screen.id.trim() || !screen.name.trim()) issues.push({ severity: 'error', code: 'SCREEN_IDENTITY', message: 'Screen id and name are required.' });
  const ids = new Set<string>();
  for (const c of screen.components) {
    if (!c.id.trim() || !c.name.trim()) issues.push({ severity: 'error', code: 'COMPONENT_IDENTITY', message: 'Every component needs an id and name.', componentId: c.id });
    if (ids.has(c.id)) issues.push({ severity: 'error', code: 'DUPLICATE_COMPONENT', message: `Duplicate component id: ${c.id}`, componentId: c.id });
    ids.add(c.id);
    if (c.parentId && c.parentId !== c.id && !screen.components.some(p => p.id === c.parentId)) issues.push({ severity: 'error', code: 'MISSING_PARENT', message: `Parent ${c.parentId} does not exist.`, componentId: c.id });
    if (c.style?.transparency !== undefined && (c.style.transparency < 0 || c.style.transparency > 1)) issues.push({ severity: 'error', code: 'TRANSPARENCY_RANGE', message: 'Transparency must be between 0 and 1.', componentId: c.id });
    if (c.style?.textSize !== undefined && c.style.textSize <= 0) issues.push({ severity: 'error', code: 'TEXT_SIZE', message: 'Text size must be positive.', componentId: c.id });
  }
  if (!ids.has(screen.rootId)) issues.push({ severity: 'error', code: 'MISSING_ROOT', message: `Root component ${screen.rootId} does not exist.` });
  const states = new Map<string, Set<UIState>>();
  for (const c of screen.components) for (const s of c.states ?? []) {
    const set = states.get(c.id) ?? new Set<UIState>(); set.add(s.state); states.set(c.id, set);
  }
  for (const c of screen.components) if (c.kind === 'button' && !(states.get(c.id)?.has('disabled') ?? false)) issues.push({ severity: 'warning', code: 'BUTTON_DISABLED_STATE', message: 'Interactive buttons should define a disabled state.', componentId: c.id });
  return issues;
}

export function componentMap(screen: UIScreenSpec): Map<string, UIComponent> {
  return new Map(screen.components.map(c => [c.id, c]));
}
