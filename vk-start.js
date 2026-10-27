import {browserBridge, startVkLaunch} from './vk-connection.js?v=11.17';

// This module also runs from <head>, independently of app.js and its UI.
// Authorization later reuses the same initialized bridge.
export const getBridge = browserBridge();
export const launchReady = startVkLaunch(getBridge);
launchReady.then(result => {
  const show = () => {
    const status = document.getElementById('launchStatus');
    if (status) {
      status.dataset.state = result.status;
      status.textContent = result.detail;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {once:true});
  else show();
});
