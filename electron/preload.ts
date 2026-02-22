import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('__SPACES_ELECTRON__', true);
