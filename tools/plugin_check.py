# Runs Eleosynth the way DAWters and Son 2.4 hosts it (window.SUITE_HOST), with a stand-in host:
# chord-mode notes must reach the host, drone/master must be saved in the song state and heard in an offline bounce.
import os
from playwright.sync_api import sync_playwright
URL = os.environ.get('URL', 'http://localhost:8822/eleosynth.html')
HOST = """
(() => {
  const ctx = new AudioContext(); window.__notes = []; window.__changed = 0;
  window.SUITE_HOST = { mode: 'inst', ctx, output: ctx.destination, input: null, state: null,
    addModule: async (c, name, code) => { if (c.__eleo) return; c.__eleo = 1; await c.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))); },
    note: (on, n, v) => { window.__notes.push([on, n]); window.SUITE_PLUGIN.note(on, n, v); },
    changed: () => { window.__changed++; }, ready: () => { window.__ready = true; } };
})();
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1400, 'height': 900}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(HOST); pg.goto(URL); pg.wait_for_function('window.__ready === true', timeout=20000); pg.wait_for_timeout(500)
    pg.click('.tab[data-tab=perform]'); pg.select_option('select[aria-label="Play mode"]', '1')
    pg.keyboard.down('a'); pg.wait_for_timeout(200); pg.keyboard.up('a'); pg.wait_for_timeout(200)
    print('host received:', pg.evaluate('JSON.stringify(window.__notes)'))
    pg.click('#drone-panel .power'); pg.wait_for_timeout(500)
    st = pg.evaluate('window.SUITE_PLUGIN.getState()')
    print('state has drone on:', st.get('drone', {}).get('on'), '| master:', 'master' in st, '| perf mode:', st.get('perf', {}).get('mode'), '| host notified:', pg.evaluate('window.__changed') > 0)
    rms = pg.evaluate("""async () => {
      const o = new OfflineAudioContext(2, 48000 * 3, 48000);
      await window.SUITE_PLUGIN.render(o, { output: o.destination, events: [], bpm: 112 });
      const buf = await o.startRendering(); const d = buf.getChannelData(0); let s = 0; for (let i = 48000; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / (d.length - 48000)); }""")
    print('offline bounce with only the drone: rms', round(rms, 4), 'PASS' if rms > 0.003 else 'FAIL')
    pg.evaluate("window.SUITE_PLUGIN.setState(Object.assign(window.SUITE_PLUGIN.getState(), { drone: Object.assign(window.SUITE_PLUGIN.getState().drone, { on: 0 }) }))")
    pg.wait_for_timeout(300); print('setState turns the drone panel off:', pg.evaluate("document.getElementById('drone-panel').classList.contains('off')"))
    b.close()
print(errs or 'no page errors')
