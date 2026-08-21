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
  const names = new Set<string>();
  for (const c of screen.components) {
    if (!c.id.trim() || !c.name.trim()) issues.push({ severity: 'error', code: 'COMPONENT_IDENTITY', message: 'Every component needs an id and name.', componentId: c.id });
    if (ids.has(c.id)) issues.push({ severity: 'error', code: 'DUPLICATE_COMPONENT', message: `Duplicate component id: ${c.id}`, componentId: c.id });
    ids.add(c.id);
    const lower = c.name.trim().toLowerCase();
    if (lower && names.has(lower)) issues.push({ severity: 'warning', code: 'DUPLICATE_NAME', message: `Duplicate component name: ${c.name}`, componentId: c.id });
    else if (lower) names.add(lower);
    if (c.parentId && c.parentId !== c.id && !screen.components.some(p => p.id === c.parentId)) issues.push({ severity: 'error', code: 'MISSING_PARENT', message: `Parent ${c.parentId} does not exist.`, componentId: c.id });
    if (c.style?.transparency !== undefined && (c.style.transparency < 0 || c.style.transparency > 1)) issues.push({ severity: 'error', code: 'TRANSPARENCY_RANGE', message: 'Transparency must be between 0 and 1.', componentId: c.id });
    if (c.style?.textSize !== undefined && c.style.textSize <= 0) issues.push({ severity: 'error', code: 'TEXT_SIZE', message: 'Text size must be positive.', componentId: c.id });
    if (c.style?.spacing !== undefined && c.style.spacing < 0) issues.push({ severity: 'error', code: 'SPACING_RANGE', message: 'Spacing must be non-negative.', componentId: c.id });
    if (c.style?.padding !== undefined && c.style.padding < 0) issues.push({ severity: 'error', code: 'PADDING_RANGE', message: 'Padding must be non-negative.', componentId: c.id });
    if (c.style?.cornerRadius !== undefined && (c.style.cornerRadius < 0 || c.style.cornerRadius > 40)) issues.push({ severity: 'warning', code: 'CORNER_RADIUS', message: 'cornerRadius should be 0–40.', componentId: c.id });
    if (c.style?.colorToken && !screen.theme.tokens[c.style.colorToken]) issues.push({ severity: 'warning', code: 'UNKNOWN_TOKEN', message: `colorToken ${c.style.colorToken} not in theme.tokens`, componentId: c.id });
    if (c.layout && !['absolute', 'list', 'grid', 'page'].includes(c.layout)) issues.push({ severity: 'error', code: 'LAYOUT_KIND', message: `Unknown layout ${c.layout}`, componentId: c.id });
  }
  if (!ids.has(screen.rootId)) issues.push({ severity: 'error', code: 'MISSING_ROOT', message: `Root component ${screen.rootId} does not exist.` });
  // Depth check
  const parentMap = new Map<string, string | undefined>();
  for (const c of screen.components) parentMap.set(c.id, c.parentId);
  for (const c of screen.components) {
    let depth = 0; let cur: string | undefined = c.id;
    const seen = new Set<string>();
    while (cur && parentMap.get(cur) && !seen.has(cur) && depth < 20) { seen.add(cur); cur = parentMap.get(cur); depth += 1; }
    if (depth > 6) issues.push({ severity: 'warning', code: 'DEPTH_EXCEEDED', message: `Component ${c.id} nesting depth ${depth} >6 may affect performance.`, componentId: c.id });
  }
  if (Object.keys(screen.theme.tokens).length === 0) issues.push({ severity: 'warning', code: 'THEME_TOKENS_EMPTY', message: 'theme.tokens is empty — define palette, radii, spacing for style consistency.' });
  if (screen.responsive.rules.length === 0 && screen.components.length > 3) issues.push({ severity: 'warning', code: 'RESPONSIVE_RULES_MISSING', message: 'Add responsive rules for multi-device layout.' });
  const states = new Map<string, Set<UIState>>();
  for (const c of screen.components) for (const s of c.states ?? []) {
    const set = states.get(c.id) ?? new Set<UIState>(); set.add(s.state); states.set(c.id, set);
  }
  for (const c of screen.components) if (c.kind === 'button' && !(states.get(c.id)?.has('disabled') ?? false)) issues.push({ severity: 'warning', code: 'BUTTON_DISABLED_STATE', message: 'Interactive buttons should define a disabled state.', componentId: c.id });
  // ForgeGUI parity check: ensure at least one frame container for layout grouping when many components
  if (screen.components.filter(c => c.kind === 'button').length > 3 && !screen.components.some(c => c.kind === 'frame' && c.layout === 'list')) {
    issues.push({ severity: 'warning', code: 'LAYOUT_GROUPING', message: 'Consider a Frame with layout list/grid to group buttons for ForgeGUI parity.' });
  }
  return issues;
}

export function forgeGuiParityScore(screen: UIScreenSpec): { score: number; max: number; issues: UIValidationIssue[] } {
  const issues = validateScreen(screen);
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const max = 100;
  let score = 100;
  score -= errors * 15;
  score -= warnings * 4;
  if (Object.keys(screen.theme.tokens).length >= 4) score += 5;
  if (screen.responsive.rules.length > 0) score += 5;
  score = Math.max(0, Math.min(100, score));
  return { score, max, issues };
}

export function componentMap(screen: UIScreenSpec): Map<string, UIComponent> {
  return new Map(screen.components.map(c => [c.id, c]));
}
