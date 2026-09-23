(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = window.DOCKFLOW_CONFIG || {};
  const ready = /^https:\/\//.test(cfg.supabaseUrl || '') &&
    cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('COLE_') && window.supabase;
  let db, timer, isRefreshing = false, dashboard = { docks: [], tickets: [] };
  let lastTrackingStatus = null;
  let adminAlertsInitialized = false;
  let adminAlertsEnabled = localStorage.getItem('dockflow_admin_alerts') === '1';
  let adminAudioContext = null;
  const adminKnownWaitingIds = new Set();
  const storageKey = 'dockflow_tracking_token';
  const viewNames = ['config', 'checkin', 'tracking', 'login', 'admin'];
  const show = name => viewNames.forEach(v => $(`${v}-view`).classList.toggle('hidden', v !== name));
  const error = (id, message) => { $(id).textContent = message || ''; $(id).classList.toggle('hidden', !message); };
  const setLoading = (id, yes, text) => { $(id).disabled = yes; if (text) $(id).textContent = text; };
  const cleanError = err => {
    const s = err?.message || 'Não foi possível concluir. Tente novamente.';
    if (/failed to fetch|network|fetch failed|ERR_EMPTY_RESPONSE/i.test(s)) return 'Falha de conexão. Verifique sua internet e tente novamente.';
    return s;
  };
  const fmtTime = t => t ? new Date(t).toLocaleString('pt-BR', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',timeZone:'America/Sao_Paulo'}) : '—';
  const element = (tag, className, value) => { const el=document.createElement(tag); if(className) el.className=className; if(value != null) el.textContent=String(value); return el; };
  const button = (label, action, kind='secondary') => { const b=element('button', `button ${kind} compact`, label); b.type='button'; b.addEventListener('click',action); return b; };
  const clearTimer = () => { if(timer) window.clearInterval(timer); timer=null; };

  function updateAdminAlertButton() {
    const b = $('admin-alert-toggle');
    if (!b) return;
    if (adminAlertsEnabled) {
      b.textContent = 'Alertas ativos';
      b.classList.add('alert-enabled');
      b.title = 'Som e notificações de novos check-ins estão ativados neste navegador.';
    } else {
      b.textContent = 'Ativar alertas';
      b.classList.remove('alert-enabled');
      b.title = 'Clique para ativar som e notificações de novos check-ins.';
    }
  }

  function setupAdminAlerts() {
    const head = document.querySelector('.admin-head');
    const logout = $('logout');
    if (!head || !logout) return;
    let actions = head.querySelector('.admin-actions');
    if (!actions) {
      actions = element('div', 'admin-actions');
      head.append(actions);
      actions.append(logout);
    }
    if (!$('admin-alert-toggle')) {
      const toggle = button('Ativar alertas', activateAdminAlerts, 'secondary');
      toggle.id = 'admin-alert-toggle';
      actions.insertBefore(toggle, logout);
    }
    updateAdminAlertButton();
  }

  async function activateAdminAlerts() {
    adminAlertsEnabled = true;
    localStorage.setItem('dockflow_admin_alerts', '1');
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && !adminAudioContext) adminAudioContext = new AudioCtx();
      if (adminAudioContext?.state === 'suspended') await adminAudioContext.resume();
    } catch (_) {}
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (_) {}
    updateAdminAlertButton();
    showAdminToast({first_name:'DockFlow', last_name:'', plate:'', number:''}, true);
  }

  function playAdminBeep() {
    if (!adminAlertsEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!adminAudioContext) adminAudioContext = new AudioCtx();
      if (adminAudioContext.state === 'suspended') return;
      const ctx = adminAudioContext;
      const now = ctx.currentTime;
      [[0,880],[0.22,660]].forEach(([offset,freq]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + offset); osc.stop(now + offset + 0.18);
      });
    } catch (_) {}
  }

  function showAdminToast(ticket, activationOnly=false) {
    const toast = element('div', 'admin-checkin-alert');
    const close = element('button', 'admin-alert-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label','Fechar alerta');
    close.addEventListener('click',()=>toast.remove());
    const title = element('strong', '', activationOnly ? 'Alertas ativados' : 'Novo motorista na fila');
    const body = element('p', '', activationOnly
      ? 'Quando houver um novo check-in, este painel exibirá um aviso e tentará tocar um som.'
      : `Senha ${String(ticket.number).padStart(4,'0')} · ${ticket.first_name} ${ticket.last_name} · ${ticket.plate}`);
    toast.append(close,title,body);
    if (!activationOnly) {
      toast.addEventListener('click', e=>{
        if (e.target === close) return;
        $('queue-list')?.scrollIntoView({behavior:'smooth',block:'center'});
      });
    }
    document.body.append(toast);
    requestAnimationFrame(()=>toast.classList.add('show'));
    window.setTimeout(()=>{
      toast.classList.remove('show');
      window.setTimeout(()=>toast.remove(),350);
    }, activationOnly ? 5000 : 12000);
  }

  function notifyAdminNewCheckin(ticket) {
    showAdminToast(ticket);
    playAdminBeep();
    document.title = `NOVO CHECK-IN — ${ticket.plate} | DockFlow`;
    window.setTimeout(()=>{
      if (document.title.startsWith('NOVO CHECK-IN')) document.title = 'Painel de docas | DockFlow';
    }, 9000);
    if (adminAlertsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('Novo motorista na fila', {
          body: `Senha ${String(ticket.number).padStart(4,'0')} · ${ticket.first_name} ${ticket.last_name} · ${ticket.plate}`,
          tag: `dockflow-${ticket.id}`
        });
        n.onclick = () => { window.focus(); $('queue-list')?.scrollIntoView({behavior:'smooth',block:'center'}); n.close(); };
      } catch (_) {}
    }
  }

  function detectNewAdminCheckins(data) {
    const waiting = (data?.tickets || []).filter(t=>t.status === 'waiting');
    if (!adminAlertsInitialized) {
      waiting.forEach(t=>adminKnownWaitingIds.add(t.id));
      adminAlertsInitialized = true;
      return;
    }
    const newTickets = waiting.filter(t=>!adminKnownWaitingIds.has(t.id));
    waiting.forEach(t=>adminKnownWaitingIds.add(t.id));
    newTickets.forEach(notifyAdminNewCheckin);
  }

  function announceCall(dock) {
    if (navigator.vibrate) {
      try { navigator.vibrate([500, 180, 500, 180, 900]); } catch (_) {}
    }
    document.title = `CHAMADO — ${dock || 'Doca'} | DockFlow`;
  }

  function setTrackingAppearance(status, dock) {
    const view = $('tracking-view');
    view.classList.toggle('called-screen', status === 'called');
    view.classList.toggle('done-screen', status === 'done');
    view.classList.toggle('cancelled-screen', status === 'cancelled');

    if (status === 'called') {
      $('ticket-status').textContent = 'VOCÊ FOI CHAMADO';
      $('ticket-status').className = 'pill active call-pill';
      $('ticket-message').textContent = `DIRIJA-SE À ${String(dock || 'DOCA INDICADA').toUpperCase()}`;
    } else if (status === 'done') {
      $('ticket-status').textContent = 'ATENDIMENTO CONCLUÍDO';
      $('ticket-status').className = 'pill done';
      $('ticket-message').textContent = 'Seu atendimento foi encerrado. Obrigado!';
      document.title = 'Atendimento concluído | DockFlow';
    } else if (status === 'cancelled') {
      $('ticket-status').textContent = 'CHECK-IN CANCELADO';
      $('ticket-status').className = 'pill done';
      $('ticket-message').textContent = 'Seu check-in foi cancelado. Procure a portaria.';
      document.title = 'Check-in cancelado | DockFlow';
    } else {
      $('ticket-status').textContent = 'AGUARDANDO';
      $('ticket-status').className = 'pill';
      $('ticket-message').textContent = 'Você está na fila. Esta página atualiza automaticamente.';
      document.title = 'Aguardando chamada | DockFlow';
    }
  }

  function routeToTracking(token) {
    localStorage.setItem(storageKey,token);
    history.replaceState(null,'',`?ticket=${encodeURIComponent(token)}`);
    show('tracking'); clearTimer(); lastTrackingStatus = null; refreshTracking(token);
    timer=window.setInterval(()=>refreshTracking(token),8000);
  }

  async function refreshTracking(token) {
    const {data,err,error:rpcError}=await db.rpc('driver_status',{p_token:token});
    if (err||rpcError){error('tracking-error',cleanError(err||rpcError));return;}
    if(!data){error('tracking-error','Senha não encontrada. Confira o link recebido.');return;}
    error('tracking-error',null);
    $('ticket-number').textContent=String(data.number).padStart(4,'0');
    $('ticket-plate').textContent=data.plate;
    $('ticket-position').textContent=data.position || '—';
    $('ticket-dock').textContent=data.dock || '—';

    if (data.status === 'called' && lastTrackingStatus !== 'called') announceCall(data.dock);
    setTrackingAppearance(data.status, data.dock);
    lastTrackingStatus = data.status;

    if(data.status==='done'||data.status==='cancelled') {
      localStorage.removeItem(storageKey);
      clearTimer();
    }
  }

  async function checkIn(event) {
    event.preventDefault();error('checkin-error','');
    const first=$('first-name').value.trim(),last=$('last-name').value.trim();
    const plate=$('plate').value.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!first || !last || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
      error('checkin-error','Preencha nome, sobrenome e placa brasileira com 7 caracteres.');return;
    }
    setLoading('checkin-submit',true,'Registrando...');
    const {data,error:rpcError}=await db.rpc('driver_checkin',{p_first_name:first,p_last_name:last,p_plate:plate});
    setLoading('checkin-submit',false,'Entrar na fila');
    if(rpcError){error('checkin-error',cleanError(rpcError));return;}
    routeToTracking(data.tracking_token);
  }

  async function login(event) {
    event.preventDefault();error('login-error','');setLoading('login-submit',true,'Entrando...');
    const {error:loginError}=await db.auth.signInWithPassword({email:$('login-email').value.trim(),password:$('login-password').value});
    if(loginError){error('login-error','Credenciais incorretas ou acesso indisponível.');setLoading('login-submit',false,'Entrar');return;}
    const {data,error:adminError}=await db.rpc('is_dock_admin');
    if(adminError||!data){await db.auth.signOut();error('login-error','Este usuário não tem permissão para administrar as docas.');setLoading('login-submit',false,'Entrar');return;}
    setLoading('login-submit',false,'Entrar');openAdmin();
  }

  async function refreshAdmin() {
    if(isRefreshing)return;
    isRefreshing=true;
    try {
      const {data,error:rpcError}=await db.rpc('admin_dashboard');
      if(rpcError)throw rpcError;
      detectNewAdminCheckins(data);
      dashboard=data;renderAdmin();error('admin-error',null);
      $('last-update').textContent=`Última atualização: ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch(err){error('admin-error',cleanError(err));}
    finally{isRefreshing=false;}
  }

  async function action(name,params) {
    error('admin-error',null);
    const {error:rpcError}=await db.rpc(name,params);
    if(rpcError){error('admin-error',cleanError(rpcError));return;}
    await refreshAdmin();
  }

  function renderAdmin() {
    const tickets=dashboard.tickets||[],docks=dashboard.docks||[];
    const waiting=tickets.filter(t=>t.status==='waiting').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||a.number-b.number);
    const active=tickets.filter(t=>t.status==='called');
    const done=tickets.filter(t=>t.status==='done'&&new Date(t.finished_at).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}));
    $('count-waiting').textContent=waiting.length;
    $('count-active').textContent=active.length;
    $('count-done').textContent=done.length;
    $('dock-list').replaceChildren();
    docks.forEach(d=>{
      const current=active.find(t=>t.dock_id===d.id);
      const block=element('article',`dock ${current?'busy':''}`),head=element('div','dock-title');
      head.append(element('span','',d.name),element('span','',!d.enabled?'Inativa':current?'Ocupada':'Livre'));block.append(head);
      block.append(element('p','',current?`${current.plate} · ${current.first_name} ${current.last_name}`:'Pronta para receber o próximo motorista'));
      if(d.enabled && !current) block.append(button('Chamar próximo',()=>action('admin_call_next',{p_dock_id:d.id}),'primary'));
      if(current)block.append(button('Concluir atendimento',()=>action('admin_finish',{p_ticket_id:current.id}),'primary'));
      $('dock-list').append(block);
    });
    function renderRows(id,items,kind) {
      const parent=$(id);parent.replaceChildren();
      if(!items.length){parent.append(element('div','empty',kind==='waiting'?'Nenhum motorista aguardando.':kind==='active'?'Nenhum veículo em atendimento.':'Nenhum atendimento encerrado hoje.'));return;}
      items.forEach((t,i)=>{
        const row=element('article','queue-item'),details=element('div');
        details.append(element('strong','',`${kind==='waiting'?`${i+1}º · `:''}Senha ${String(t.number).padStart(4,'0')} · ${t.first_name} ${t.last_name}`));
        const dock=docks.find(d=>d.id===t.dock_id);
        details.append(element('p','',`${t.plate} · Chegada ${fmtTime(t.created_at)}${dock?' · '+dock.name:''}`));row.append(details);
        if(kind!=='history')row.append(button(kind==='waiting'?'Cancelar check-in':'Cancelar atendimento',()=>{
          if(window.confirm('Deseja cancelar este registro?'))action('admin_cancel',{p_ticket_id:t.id});
        }));
        parent.append(row);
      });
    }
    renderRows('queue-list',waiting,'waiting');renderRows('active-list',active,'active');renderRows('history-list',done,'history');
  }

  function makeQR() {
    const url=new URL(window.location.href);url.search='';url.hash='';
    $('qr-url').textContent=url.href;
    if(window.QRCode){$('qrcode').replaceChildren();new QRCode($('qrcode'),{text:url.href,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});}
    else $('qrcode').textContent='Não foi possível carregar o QR Code. Use o link acima.';
  }

  function openAdmin(){history.replaceState(null,'','?admin=1');show('admin');clearTimer();setupAdminAlerts();makeQR();refreshAdmin();timer=window.setInterval(refreshAdmin,5000);}

  async function boot() {
    if(!ready){show('config');return;}
    db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}});
    $('checkin-form').addEventListener('submit',checkIn);
    $('plate').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);});
    $('tracking-refresh').addEventListener('click',()=>{const token=new URLSearchParams(location.search).get('ticket')||localStorage.getItem(storageKey);if(token)refreshTracking(token);});
    $('resume-link').addEventListener('click',e=>{e.preventDefault();const token=localStorage.getItem(storageKey);if(token)routeToTracking(token);else error('checkin-error','Não encontramos uma senha salva neste celular. Se já fez check-in, use o link da sua senha.');});
    $('login-form').addEventListener('submit',login);
    $('admin-refresh').addEventListener('click',refreshAdmin);
    $('logout').addEventListener('click',async()=>{clearTimer();adminAlertsInitialized=false;adminKnownWaitingIds.clear();await db.auth.signOut();history.replaceState(null,'','?admin=1');show('login');});
    $('print-qr').addEventListener('click',()=>window.print());
    const params=new URLSearchParams(location.search),token=params.get('ticket');
    if(params.has('admin')){
      const {data:{session}}=await db.auth.getSession();
      if(session){const {data}=await db.rpc('is_dock_admin');if(data){openAdmin();return;}await db.auth.signOut();}
      show('login');return;
    }
    if(token && /^[0-9a-f-]{36}$/i.test(token)){routeToTracking(token);return;}
    if(location.hash==='#acompanhar' && localStorage.getItem(storageKey)){routeToTracking(localStorage.getItem(storageKey));return;}
    show('checkin');
  }

  boot().catch(e=>{show('config');$('config-view').querySelector('p').textContent=cleanError(e);});
})();
