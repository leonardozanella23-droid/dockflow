(() => {
  'use strict';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  // Guardamos os métodos nativos antes de silenciar o bip antigo.
  const nativeCreateGain = AudioCtx.prototype.createGain;
  const nativeCreateOscillator = AudioCtx.prototype.createOscillator;

  // Silencia apenas os gains criados pelo código antigo do painel.
  // O novo alerta usa os métodos nativos salvos acima.
  AudioCtx.prototype.createGain = function () {
    const gain = nativeCreateGain.call(this);
    const originalSet = gain.gain.setValueAtTime.bind(gain.gain);
    const originalLinear = gain.gain.linearRampToValueAtTime.bind(gain.gain);
    const originalExpo = gain.gain.exponentialRampToValueAtTime.bind(gain.gain);

    gain.gain.setValueAtTime = (value, time) => originalSet(Math.min(value, 0.0001), time);
    gain.gain.linearRampToValueAtTime = (value, time) => originalLinear(Math.min(value, 0.0001), time);
    gain.gain.exponentialRampToValueAtTime = (value, time) => originalExpo(Math.min(value, 0.0001), time);

    return gain;
  };

  let alertPlaying = false;

  async function playStrongAlert() {
    if (alertPlaying) return;
    alertPlaying = true;

    try {
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();

      const master = nativeCreateGain.call(ctx);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.connect(ctx.destination);

      const start = ctx.currentTime + 0.02;
      const pulses = [
        [0.00, 1080, 0.34],
        [0.34, 760, 0.34],
        [0.68, 1080, 0.34],
        [1.02, 760, 0.34],
        [1.36, 1080, 0.34],
        [1.70, 760, 0.48]
      ];

      for (const [offset, freq, duration] of pulses) {
        const osc1 = nativeCreateOscillator.call(ctx);
        const osc2 = nativeCreateOscillator.call(ctx);
        const gain = nativeCreateGain.call(ctx);

        osc1.type = 'square';
        osc2.type = 'sawtooth';

        osc1.frequency.setValueAtTime(freq, start + offset);
        osc2.frequency.setValueAtTime(freq * 1.5, start + offset);

        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.42, start + offset + 0.02);
        gain.gain.setValueAtTime(0.42, start + offset + duration - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(master);

        osc1.start(start + offset);
        osc2.start(start + offset);
        osc1.stop(start + offset + duration + 0.02);
        osc2.stop(start + offset + duration + 0.02);
      }

      master.gain.setValueAtTime(0.72, start);
      master.gain.setValueAtTime(0.72, start + 2.15);
      master.gain.exponentialRampToValueAtTime(0.0001, start + 2.22);

      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
        alertPlaying = false;
      }, 2600);

    } catch (_) {
      alertPlaying = false;
    }
  }

  function isNewDriverToast(node) {
    if (!(node instanceof HTMLElement)) return false;
    const toast = node.matches?.('.admin-checkin-alert')
      ? node
      : node.querySelector?.('.admin-checkin-alert');

    if (!toast) return false;
    const text = (toast.innerText || toast.textContent || '').toLowerCase();
    return text.includes('novo motorista');
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isNewDriverToast(node)) {
          playStrongAlert();
          return;
        }
      }
    }
  });

  const startObserver = () => observer.observe(document.body, { childList: true, subtree: true });

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
})();
