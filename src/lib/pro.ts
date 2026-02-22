let _pro: any = null;
let _checked = false;

export function getPro() {
  if (!_checked) {
    try { _pro = require('@spaces/pro'); } catch {}
    _checked = true;
  }
  return _pro;
}

export function hasPro(): boolean {
  return getPro() !== null;
}
