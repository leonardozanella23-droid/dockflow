(() => {
  'use strict';

  const isLoadFlow = !!window.LOADFLOW_CONFIG;
  const cfg = isLoadFlow ? window.LOADFLOW_CONFIG : window.DOCKFLOW_CONFIG;
  const queueRpc = isLoadFlow ? 'loading_admin_queue_order' : 'admin_queue_order';
  const moveRpc = isLoadFlow ? 'loading_admin_move_queue' : 'admin_move_queue';

  if (!cfg || !window.supabase) return;

  let db = null;
  let syncing = false;

  function ensureClient() {
    if (!db) {
      db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
      });
    }
    return db;
  }

  function injectStyles() {
    if (document.getElementById('queue-order-style')) return;
    const style = document.createElement('style');
    style.id = 'queue-order-style';
    style.textContent = `
      .queue-order-hint{
        margin:10px 0 14px;
        padding:11px 13px;
        border:1px solid #b9ead6;
        border-radius:10px;
        background:#eafaf3;
        color:#147454;
        font-size:13px;
        font-weight:700;
      }
      .queue-order-controls{
        display:flex;
        gap:6px;
        margin-left:auto;
        align-items:center;
      }
      .queue-order-btn{
        border:0;
        border-radius:9px;
        min-width:42px;
        height:38px;
        padding:0 11px;
        font:inherit;
        font-weight:900;
        font-size:18px;
        cursor:pointer;
        background:#173f52;
        color:#fff;
      }
      .queue-order-btn:hover{background:#0f3040}
      .queue-order-btn:disabled{opacity:.28;cursor:not-allowed}
      @media(max-width:600px){
        .queue-order-controls{width:100%;justify-content:flex-end}
        .queue-order-btn{min-width:48px}
      }
    `;
    document.head.appendChild(style);
  }

  function addHint() {
    const list = document.getElementById('queue-list');
    if (!list) return;
    const panel = list.closest('.panel');
    if (!panel || panel.querySelector('.queue-order-hint')) return;
    const hint = document.createElement('div');
    hint.className = 'queue-order-hint';
    hint.textContent = 'Ordem manual ativa: use ↑ e ↓ para definir quem será chamado primeiro.';
    list.before(hint);
  }

  async function moveTicket(ticketId, direction, button) {
    if (button) button.disabled = true;
    try {
      const client = ensureClient();
      const { error } = await client.rpc(moveRpc, {
        p_ticket_id: ticketId,
        p_direction: direction
      });
      if (error) throw error;

      const refresh = document.getElementById('admin-refresh');
      if (refresh) refresh.click();

      window.setTimeout(syncQueue, 250);
    } catch (err) {
      const box = document.getElementById('admin-error');
      if (box) {
        box.textContent = err?.message || 'Não foi possível alterar a ordem da fila.';
        box.classList.remove('hidden');
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function findRowByTicketNumber(rows, number) {
    const token = `Senha ${String(number).padStart(4, '0')}`;
    return rows.find(row => (row.textContent || '').includes(token));
  }

  async function syncQueue() {
    if (syncing) return;
    const adminView = document.getElementById('admin-view');
    const list = document.getElementById('queue-list');
    if (!adminView || adminView.classList.contains('hidden') || !list) return;

    syncing = true;
    try {
      injectStyles();
      addHint();

      const client = ensureClient();
      const { data, error } = await client.rpc(queueRpc);
      if (error) throw error;

      const tickets = Array.isArray(data) ? data : [];
      const rows = [...list.querySelectorAll('.queue-item')];

      tickets.forEach((ticket, index) => {
        const row = findRowByTicketNumber(rows, ticket.number);
        if (!row) return;

        const strong = row.querySelector('strong');
        if (strong) {
          strong.textContent = strong.textContent.replace(/^\d+º · /, `${index + 1}º · `);
        }

        let controls = row.querySelector('.queue-order-controls');
        if (!controls) {
          controls = document.createElement('div');
          controls.className = 'queue-order-controls';

          const up = document.createElement('button');
          up.type = 'button';
          up.className = 'queue-order-btn';
          up.textContent = '↑';
          up.title = 'Subir na fila';

          const down = document.createElement('button');
          down.type = 'button';
          down.className = 'queue-order-btn';
          down.textContent = '↓';
          down.title = 'Descer na fila';

          controls.append(up, down);
          row.append(controls);
        }

        const [up, down] = controls.querySelectorAll('.queue-order-btn');
        up.disabled = index === 0;
        down.disabled = index === tickets.length - 1;
        up.onclick = () => moveTicket(ticket.id, -1, up);
        down.onclick = () => moveTicket(ticket.id, 1, down);

        list.append(row);
      });
    } catch (err) {
      const message = err?.message || '';
      if (/admin_queue_order|loading_admin_queue_order|function.*does not exist|schema cache/i.test(message)) {
        const box = document.getElementById('admin-error');
        if (box) {
          box.textContent = 'A alteração manual da fila ainda não foi ativada no Supabase.';
          box.classList.remove('hidden');
        }
      }
    } finally {
      syncing = false;
    }
  }

  function boot() {
    injectStyles();
    window.setTimeout(syncQueue, 500);
    window.setInterval(syncQueue, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
