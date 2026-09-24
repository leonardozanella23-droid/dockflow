(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.DOCKFLOW_CONFIG || {};

  function pad(n) { return String(n).padStart(2, '0'); }

  function inputDateTimeValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo'
    });
  }

  function durationMs(start, end) {
    return Math.max(0, new Date(end) - new Date(start));
  }

  function fmtDuration(ms) {
    const total = Math.floor(ms / 60000);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? `${h}h ${pad(m)}min` : `${m} min`;
  }

  function create(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function injectStyles() {
    if ($('dockflow-history-style')) return;
    const style = document.createElement('style');
    style.id = 'dockflow-history-style';
    style.textContent = `
      .history-search-heading p{margin:6px 0 0;line-height:1.45}
      .history-search-filters{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end;margin:18px 0 14px}
      .history-search-field{display:flex;flex-direction:column;gap:7px}
      .history-search-field input{width:100%}
      .history-search-summary{margin:8px 0 14px;color:#526b78;font-size:14px}
      #dockflow-historical-list .queue-item{background:#fbfcfd}
      .history-search-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}
      .history-search-tag{background:#eef4f6;border-radius:20px;padding:4px 9px;font-size:12px;color:#44616f}
      .history-search-tag.time{background:#fff3dc;color:#8a5b10}
      @media(max-width:760px){
        .history-search-filters{grid-template-columns:1fr}
        .history-search-filters .button{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function buildPanel() {
    if ($('dockflow-history-panel')) return;

    const todayList = $('history-list');
    if (!todayList) return;

    const todayPanel = todayList.closest('section.panel');
    const panel = create('section', 'panel');
    panel.id = 'dockflow-history-panel';

    panel.innerHTML = `
      <div class="section-heading history-search-heading">
        <div>
          <h2>Pesquisa de histórico</h2>
          <p class="muted">Escolha uma data e um horário inicial e final para consultar os motoristas atendidos nesse período.</p>
        </div>
      </div>
      <div class="history-search-filters">
        <div class="history-search-field">
          <label for="dock-history-start">De</label>
          <input id="dock-history-start" type="datetime-local">
        </div>
        <div class="history-search-field">
          <label for="dock-history-end">Até</label>
          <input id="dock-history-end" type="datetime-local">
        </div>
        <button id="dock-history-search" class="button primary" type="button">Buscar histórico</button>
      </div>
      <div id="dock-history-error" role="alert" class="message error hidden"></div>
      <div class="history-search-summary"><strong id="dock-history-count">Informe o período para consultar.</strong></div>
      <div id="dockflow-historical-list" class="queue-list"></div>
    `;

    todayPanel.insertAdjacentElement('afterend', panel);

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    $('dock-history-start').value = inputDateTimeValue(start);
    $('dock-history-end').value = inputDateTimeValue(now);
    $('dock-history-search').addEventListener('click', searchHistory);
  }

  function showError(message) {
    const el = $('dock-history-error');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }

  function renderHistory(items) {
    const parent = $('dockflow-historical-list');
    const count = $('dock-history-count');
    parent.replaceChildren();

    const avg = items.length
      ? items.reduce((sum, x) => sum + durationMs(x.created_at, x.finished_at), 0) / items.length
      : 0;

    count.textContent = items.length
      ? `${items.length} atendimento${items.length === 1 ? '' : 's'} encontrado${items.length === 1 ? '' : 's'} · permanência média ${fmtDuration(avg)}`
      : 'Nenhum atendimento encontrado nesse período.';

    if (!items.length) {
      parent.append(create('div', 'empty', 'Nenhum motorista encontrado no período informado.'));
      return;
    }

    items.forEach(t => {
      const row = create('article', 'queue-item');
      const detail = create('div');

      detail.append(
        create('strong', '', `Senha ${String(t.number).padStart(4, '0')} · ${t.first_name} ${t.last_name}`)
      );

      const meta = create('div', 'history-search-meta');
      [
        t.plate,
        t.dock || 'Doca não informada',
        `Chegada ${fmtDateTime(t.created_at)}`,
        `Chamada ${fmtDateTime(t.called_at)}`,
        `Saída ${fmtDateTime(t.finished_at)}`
      ].forEach(v => meta.append(create('span', 'history-search-tag', v)));

      meta.append(
        create('span', 'history-search-tag time', `Permanência ${fmtDuration(durationMs(t.created_at, t.finished_at))}`)
      );

      detail.append(meta);
      row.append(detail);
      parent.append(row);
    });
  }

  async function searchHistory() {
    showError('');

    const startEl = $('dock-history-start');
    const endEl = $('dock-history-end');
    const btn = $('dock-history-search');

    if (!startEl.value || !endEl.value) {
      showError('Informe a data e o horário inicial e final.');
      return;
    }

    const start = new Date(startEl.value);
    const end = new Date(endEl.value);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      showError('O período informado é inválido. O horário final precisa ser depois do inicial.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Buscando...';

    try {
      const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
      });

      const { data, error } = await db.rpc('admin_history', {
        p_start: start.toISOString(),
        p_end: end.toISOString()
      });

      if (error) throw error;
      renderHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e?.message || '';
      if (/admin_history|function.*does not exist|schema cache/i.test(msg)) {
        showError('O histórico ainda não foi ativado no Supabase. Execute o arquivo historico-dockflow.sql.');
      } else if (/permission|unauthorized|autoriz/i.test(msg)) {
        showError('Sua sessão administrativa expirou. Saia e entre novamente no painel.');
      } else {
        showError(msg || 'Não foi possível consultar o histórico.');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar histórico';
    }
  }

  function init() {
    injectStyles();
    buildPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
