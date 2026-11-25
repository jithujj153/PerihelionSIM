import { App } from './ui/app';
function start() {
  let app: App;
  try { app = new App(); }
  catch (e) {
    console.error(e);
    document.getElementById('loading')!.innerHTML = '<b>The 3D view could not start.</b><br>Open this file in a current version of Chrome or Edge with hardware acceleration switched on.<br><small></small>';
    document.querySelector('#loading small')!.textContent = String(e);
    return;
  }
  document.getElementById('loading')!.remove();
  let last = performance.now();
  // ask for the next frame first, so one bad frame can never freeze a live demonstration
  const loop = (t: number) => { requestAnimationFrame(loop); const dt = Math.max(0, (t - last) / 1000); last = t; try { app.frame(dt); } catch (e) { console.error(e); } };
  requestAnimationFrame(loop);
  (window as unknown as { perihelion: App }).perihelion = app;
}
// let the loading message paint before the site is built
setTimeout(start, 60);
