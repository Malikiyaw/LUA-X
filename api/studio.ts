export const config = { runtime: 'nodejs' };

import { studioHandler } from './studio-handler.js';

export function GET(request: Request): Promise<Response> {
  return studioHandler(request);
}

export function POST(request: Request): Promise<Response> {
  return studioHandler(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return studioHandler(request);
}