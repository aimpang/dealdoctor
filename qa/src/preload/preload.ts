import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, ConsolidatedIssue, LoopState, StatusEvent, DeveloperResult } from '../shared/types';

const api = {
  start: (address: string): Promise<LoopState> => ipcRenderer.invoke('qa:start', address),
  fix: (payload: { address: string; issues: ConsolidatedIssue[]; notes?: string }): Promise<{ state: LoopState; devResult: DeveloperResult }> =>
    ipcRenderer.invoke('qa:fix', payload),
  accept: (address: string): Promise<LoopState> => ipcRenderer.invoke('qa:accept', address),
  exportTrail: (address: string): Promise<string> => ipcRenderer.invoke('qa:export', address),
  listSessions: (): Promise<Array<{ address: string; updatedAt: string; runs: number }>> =>
    ipcRenderer.invoke('qa:list-sessions'),
  loadSession: (address: string): Promise<LoopState | null> => ipcRenderer.invoke('qa:load-session', address),
  readPdf: (pdfPath: string): Promise<ArrayBuffer | null> => ipcRenderer.invoke('qa:read-pdf', pdfPath),
  onStatus: (cb: (e: StatusEvent) => void) => {
    const handler = (_: unknown, e: StatusEvent) => cb(e);
    ipcRenderer.on('status', handler);
    return () => ipcRenderer.off('status', handler);
  },
  onAgent: (cb: (e: AgentEvent) => void) => {
    const handler = (_: unknown, e: AgentEvent) => cb(e);
    ipcRenderer.on('agent', handler);
    return () => ipcRenderer.off('agent', handler);
  },
};

contextBridge.exposeInMainWorld('qa', api);

export type QaApi = typeof api;
