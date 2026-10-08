(() => {
  const $ = (id) => document.getElementById(id);
  const landing = $('landing'), chat = $('chat');
  const startBtn = $('startBtn'), ageCheck = $('ageCheck'), dobInput = $('dobInput');
  const gateError = $('gateError');
  const modeVideo = $('modeVideo'), modeText = $('modeText'), modeBadge = $('modeBadge');
  const onlineLanding = $('onlineLanding'), onlineChat = $('onlineChat'), connState = $('connState');
  const messagesEl = $('messages'), msgForm = $('msgForm'), msgInput = $('msgInput');
  const nextBtn = $('nextBtn'), stopBtn = $('stopBtn'), reportBtn = $('reportBtn');
  const skipOverlayBtn = $('skipOverlayBtn'), endOverlayBtn = $('endOverlayBtn');
  const blockBtn = $('blockBtn'), privacyBtn = $('privacyBtn');
  const muteBtn = $('muteBtn'), camBtn = $('camBtn');
  const localVideo = $('localVideo'), remoteVideo = $('remoteVideo');
  const remotePlaceholder = $('remotePlaceholder'), textOnlyNotice = $('textOnlyNotice');
  const typingEl = $('typing'), toastEl = $('toast');
  const rulesBtn = $('rulesBtn'), rulesModal = $('rulesModal'), closeRules = $('closeRules');
  const reportModal = $('reportModal'), reportReason = $('reportReason'), reportDetails = $('reportDetails');
  const reportSubmit = $('reportSubmit'), reportCancel = $('reportCancel');
  const privacyModal = $('privacyModal'), closePrivacy = $('closePrivacy');
  const dlData = $('dlData'), delData = $('delData'), withdrawBtn = $('withdrawBtn'), privacyOut = $('privacyOut');
  const consentAccept = $('consentAccept'), consentWithdraw = $('consentWithdraw'), consentState = $('consentState');
  const consentDetailsBtn = $('consentDetailsBtn');
  const cookieNotice = $('cookieNotice'), cookieOk = $('cookieOk');

  let mode = 'video';
  let socket = null;
  let pc = null;
  let localStream = null;
  let isCaller = false;
  let typingTimer = null;
  let muted = false, camOff = false;
  let ageVerified = false;
  let lastDob = '';
  let wantMatch = false; // true while the chat screen expects a partner
  let paired = false;

  const CONSENT_KEY = 'tilo-consent-v1';
  let RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  // TURN is required for mobile-carrier symmetric NAT where STUN-only video
  // connects the chat but the video never appears. Served from backend env.
  fetch('/api/rtc-config').then((r) => r.json()).then((j) => {
    if (j && Array.isArray(j.iceServers) && j.iceServers.length) RTC_CONFIG = { iceServers: j.iceServers };
  }).catch(() => {});

  // Cap DOB picker to today (18y ago hint set on load).
  try {
    dobInput.max = new Date().toISOString().slice(0, 10);
    dobInput.min = '1900-01-01';
  } catch {}

  function toast(msg, ms = 3000) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  function sysMsg(t) {
    const d = document.createElement('div');
    d.className = 'msg sys';
    d.textContent = t;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMsg(who, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + (who === 'you' ? 'you' : 'stranger');
    d.textContent = text; // safe: no HTML parsing
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showGateError(msg) {
    gateError.textContent = msg;
    gateError.classList.remove('hidden');
  }
  function clearGateError() {
    gateError.textContent = '';
    gateError.classList.add('hidden');
  }

  function setMode(m) {
    mode = m;
    modeVideo.classList.toggle('active', m === 'video');
    modeText.classList.toggle('active', m === 'text');
    modeBadge.textContent = m === 'video' ? 'Video' : 'Text';
  }
  modeVideo.onclick = () => setMode('video');
  modeText.onclick = () => setMode('text');

  rulesBtn.onclick = () => rulesModal.classList.remove('hidden');
  closeRules.onclick = () => rulesModal.classList.add('hidden');
  rulesModal.addEventListener('click', (e) => { if (e.target === rulesModal) rulesModal.classList.add('hidden'); });
  reportCancel.onclick = () => reportModal.classList.add('hidden');
  closePrivacy.onclick = () => privacyModal.classList.add('hidden');
  privacyModal.addEventListener('click', (e) => { if (e.target === privacyModal) privacyModal.classList.add('hidden'); });

  // ---- Consent (itemised DPDP notice; withdrawal as easy as giving) ----
  function readConsent() {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); } catch { return null; }
  }
  function paintConsent() {
    const c = readConsent();
    consentState.textContent = c ? (c.consent ? `Accepted · ${c.version}` : 'Withdrawn') : 'Not decided';
  }
  async function postConsent(consent) {
    try {
      const r = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent,
          purposes: ['matching-relay', 'safety-screening', 'security-logging-180d-india', 'grievance-handling'],
        }),
      });
      const j = await r.json().catch(() => ({}));
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ consent, version: j.version || '2026-10-06-v1', at: new Date().toISOString() }));
    } catch {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ consent, version: 'local-only', at: new Date().toISOString() }));
    }
    paintConsent();
    toast(consent ? 'Consent recorded. You can withdraw anytime under Privacy.' : 'Consent withdrawn. Matching is disabled until you accept again.');
  }
  consentAccept.onclick = () => postConsent(true);
  consentWithdraw.onclick = () => postConsent(false);
  withdrawBtn.onclick = () => { postConsent(false); };
  consentDetailsBtn.onclick = () => { window.open('/legal/privacy.html', '_blank', 'noopener'); };
  paintConsent();

  // ---- Minimal cookie notice (no tracking cookies exist) ----
  try {
    if (!localStorage.getItem('tilo-cookie-ok')) cookieNotice.classList.remove('hidden');
  } catch { cookieNotice.classList.remove('hidden'); }
  cookieOk.onclick = () => {
    try { localStorage.setItem('tilo-cookie-ok', '1'); } catch {}
    cookieNotice.classList.add('hidden');
  };

  function ensureSocket() {
    if (socket) return socket;
    // same-origin, no extra transports leaking IP beyond necessary
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setConn('connected');
      console.debug('[tilo] connected', socket.id);
      // Mobile networks flap: the server drops queue state on disconnect, so
      // re-attest + re-queue automatically when the chat screen is open.
      if (wantMatch && !paired && chat.classList.contains('active')) {
        if (ageVerified && lastDob) socket.emit('attest-age', { dob: lastDob, confirm18: true });
        socket.emit('find-partner', { mode });
      }
    });
    socket.on('disconnect', (reason) => {
      setConn('disconnected');
      console.debug('[tilo] disconnected', reason);
      paired = false;
      cleanupPeer();
    });
    socket.on('connect_error', (e) => {
      // Surfaces handshake rejections (wrong APP_ORIGIN, rate limit) that
      // otherwise leave the landing page on "— online" with no explanation.
      console.debug('[tilo] connect_error', (e && e.message) || e);
      setConn('connection failed — check server URL');
    });
    socket.on('online-count', (d) => {
      const t = (d && d.count) + ' online';
      onlineLanding.textContent = t;
      onlineChat.textContent = d.count;
    });
    socket.on('waiting', () => {
      paired = false;
      setConn('searching…');
      sysMsg('Looking for a stranger…');
      remotePlaceholder.style.display = 'flex';
      remotePlaceholder.textContent = 'Looking for a stranger…';
    });
    socket.on('queue-status', (d) => {
      console.debug('[tilo] queue', d);
    });
    socket.on('still-waiting', () => toast('Still searching… try Next'));
    socket.on('rate-limited', () => toast('Slow down — too many requests'));
    socket.on('server-busy', () => toast('Service is busy. Please try again shortly.'));
    socket.on('connection-limit', () => toast('Too many active connections from this network.'));
    socket.on('banned', (d) => toast('This network is temporarily restricted for safety violations.'));
    socket.on('age-required', () => toast('18+ verification required — enter DOB on the landing screen.'));
    socket.on('age-ok', () => { ageVerified = true; });
    socket.on('age-denied', (d) => {
      ageVerified = false;
      toast(d && d.message ? d.message : 'Age verification failed. 18+ only.');
      showGateError(d && d.message ? d.message : 'Age verification failed.');
    });
    socket.on('message-blocked', (d) => {
      toast(d && d.message ? d.message : 'Message blocked for safety.');
      if (d && d.category) sysMsg(`[Safety] Outgoing message blocked (${d.category}).`);
    });
    socket.on('matched', async (d) => {
      paired = true;
      isCaller = d.role === 'caller';
      const peerMode = d && typeof d.peerMode === 'string' ? d.peerMode : null;
      const crossMode = !!(d && d.crossMode) || (peerMode && peerMode !== mode);
      setConn(crossMode ? 'connected to stranger (text)' : 'connected to stranger');
      if (crossMode) {
        sysMsg(`Connected to a stranger (you: ${mode}, stranger: ${peerMode || 'other'}). Different modes — text chat works here.`);
      } else {
        sysMsg('Connected to a stranger. Say hi! Report/Block are one tap if anything goes wrong.');
      }
      remotePlaceholder.style.display = 'flex';
      if (mode === 'text') {
        remotePlaceholder.textContent = crossMode ? 'Text chat — stranger is on video (video unavailable here)' : 'Text-only mode';
      } else if (crossMode) {
        remotePlaceholder.textContent = 'Connecting video… (stranger is on text — text chat works regardless)';
      } else {
        remotePlaceholder.textContent = 'Connecting video…';
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
      await setupPeer();
    });
    socket.on('partner-left', () => {
      paired = false;
      sysMsg('Stranger disconnected.');
      setConn('stranger left — press Next');
      cleanupPeer(false);
      remotePlaceholder.style.display = 'flex';
      remotePlaceholder.textContent = 'Stranger left. Press Next.';
    });
    socket.on('message', (d) => {
      if (!d || typeof d.text !== 'string') return;
      addMsg('stranger', d.text.slice(0, 500));
    });
    socket.on('typing', (d) => {
      typingEl.classList.toggle('hidden', !(d && d.isTyping));
    });
    // WebRTC signaling
    socket.on('webrtc-offer', async (d) => {
      if (!pc) await setupPeer();
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { answer });
      } catch (e) { console.warn(e); }
    });
    socket.on('webrtc-answer', async (d) => {
      try { await pc.setRemoteDescription(new RTCSessionDescription(d.answer)); }
      catch (e) { console.warn(e); }
    });
    socket.on('ice-candidate', async (d) => {
      try { if (d.candidate) await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); }
      catch (e) { console.warn(e); }
    });
    socket.on('reported-ack', (d) => {
      toast(d && d.ackId ? `Reported. ID ${d.ackId}. Disconnected.` : 'Reported. Disconnected.');
    });
    socket.on('blocked-ack', () => toast('Blocked. You will not be matched with them again.'));
    return socket;
  }

  function setConn(t) { connState.textContent = t; }

  async function getLocal() {
    if (mode === 'text') return null;
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: true });
      localVideo.srcObject = localStream;
      textOnlyNotice.classList.add('hidden');
    } catch (e) {
      toast('Camera blocked — continuing in text mode');
      setMode('text');
      textOnlyNotice.classList.remove('hidden');
      return null;
    }
    return localStream;
  }

  async function setupPeer() {
    cleanupPeer(false);
    pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ontrack = (ev) => {
      remoteVideo.srcObject = ev.streams[0];
      remotePlaceholder.style.display = 'none';
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate && socket) socket.emit('ice-candidate', { candidate: ev.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        remotePlaceholder.style.display = 'flex';
        remotePlaceholder.textContent = 'Video lost — text still works.';
      }
    };
    const stream = await getLocal();
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    if (mode === 'text') {
      remotePlaceholder.style.display = 'flex';
      remotePlaceholder.textContent = 'Text-only mode';
      textOnlyNotice.classList.remove('hidden');
      return;
    } else {
      textOnlyNotice.classList.add('hidden');
    }

    if (isCaller) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { offer });
      } catch (e) { console.warn(e); }
    }
    // If the stranger is on text (or has no camera), no remote track ever
    // arrives and the UI would sit on "Connecting video…" forever even though
    // text chat already works. Nudge toward text after a few seconds.
    clearTimeout(setupPeer._videoTimer);
    setupPeer._videoTimer = setTimeout(() => {
      try {
        if (mode === 'video' && pc && !remoteVideo.srcObject) {
          remotePlaceholder.style.display = 'flex';
          if (/connecting/i.test(remotePlaceholder.textContent || '')) {
            remotePlaceholder.textContent = 'Video unavailable — text chat still works.';
          }
        }
      } catch {}
    }, 8000);
  }

  function cleanupPeer(stopLocal = true) {
    try { clearTimeout(setupPeer._videoTimer); } catch {}
    try { if (pc) pc.close(); } catch {}
    pc = null;
    remoteVideo.srcObject = null;
    if (stopLocal && localStream) {
      // keep local preview across Next for speed; only stop on Stop
    }
  }

  function stopLocalTracks() {
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; localVideo.srcObject = null; }
  }

  // Wait for the server's authoritative age-ok before queueing. The old
  // optimistic flag let find-partner race attest-age on flaky mobile networks
  // and left users stuck on "searching…" with only an age-required toast.
  function attestSocketAge(dob) {
    return new Promise((resolve) => {
      const s = ensureSocket();
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      const onOk = () => { ageVerified = true; cleanup(); finish(true); };
      const onDenied = (d) => {
        ageVerified = false;
        try {
          if (d && d.message) showGateError(d.message);
          else if (d && d.code) showGateError('Age verification refused (' + d.code + '). 18+ only.');
        } catch {}
        cleanup(); finish(false);
      };
      const onRequired = () => { ageVerified = false; cleanup(); finish(false); };
      const onConnectError = (e) => {
        try { showGateError('Could not reach the chat server (' + ((e && e.message) || 'connection refused') + '). Check APP_ORIGIN / network, then retry.'); } catch {}
        cleanup(); finish(false);
      };
      function cleanup() {
        try { s.off('age-ok', onOk); s.off('age-denied', onDenied); s.off('age-required', onRequired); s.off('connect_error', onConnectError); } catch {}
        clearTimeout(timer);
      }
      s.on('age-ok', onOk);
      s.on('age-denied', onDenied);
      s.on('age-required', onRequired);
      s.on('connect_error', onConnectError);
      const timer = setTimeout(() => { cleanup(); finish(false); }, 8000);
      if (!s.connected) {
        s.once('connect', () => s.emit('attest-age', { dob, confirm18: true }));
      } else {
        s.emit('attest-age', { dob, confirm18: true });
      }
    });
  }

  async function verifyAgeGate() {
    clearGateError();
    const dob = (dobInput.value || '').trim();
    if (!dob) { showGateError('Enter your date of birth (YYYY-MM-DD). 18+ only.'); dobInput.focus(); return false; }
    if (!ageCheck.checked) { showGateError('Confirm you are 18+ and accept the Terms/Privacy/Guidelines.'); ageCheck.focus(); return false; }
    const consent = readConsent();
    if (!consent || !consent.consent) { showGateError('Please tap Accept on the itemised consent notice first — withdrawal is always one tap under Privacy.'); return false; }
    // Server-side check (REST pre-flight; socket re-attests before matching).
    try {
      const r = await fetch('/api/age-attest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dob, confirm18: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        if (r.status === 429) showGateError('Server is rate-limiting this network (429). On Render set TRUSTED_PROXY_IPS=private so each visitor gets their own quota, then retry.');
        else if (r.status === 451) showGateError('This region is not enabled yet (451). Check ALLOWED_COUNTRY_CODES.');
        else showGateError((j && j.message) || ('Age verification failed (HTTP ' + r.status + '). 18+ only.'));
        return false;
      }
    } catch {
      showGateError('Could not reach age-verification service. Try again.');
      return false;
    }
    lastDob = dob;
    const ok = await attestSocketAge(dob);
    if (!ok) {
      if (!gateError.textContent) showGateError('Age verification with the chat server failed (socket). If self-hosted on Render: set APP_ORIGIN to your https URL, TRUST_PROXY=1, TRUSTED_PROXY_IPS=private, then redeploy and hard-refresh.');
      return false;
    }
    return true;
  }

  startBtn.onclick = async () => {
    if (startBtn.disabled) return;
    startBtn.disabled = true;
    const prevLabel = startBtn.textContent;
    startBtn.textContent = 'VERIFYING…';
    try {
      const ok = await verifyAgeGate();
      if (!ok) return;
      ensureSocket();
      wantMatch = true;
      paired = false;
      landing.classList.remove('active');
      chat.classList.add('active');
      messagesEl.innerHTML = '';
      sysMsg('Welcome to Tilo (18+). Never share personal info. Report/Block are one tap.');
      setMode(mode);
      if (mode === 'video') await getLocal();
      else textOnlyNotice.classList.remove('hidden');
      socket.emit('find-partner', { mode });
      // mobile: scroll into chat, focus input on desktop only
      if (window.innerWidth > 900) msgInput.focus();
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = prevLabel;
    }
  };

  nextBtn.onclick = () => {
    if (!socket) return;
    wantMatch = true;
    paired = false;
    typingEl.classList.add('hidden');
    sysMsg('— You pressed Next —');
    cleanupPeer(false);
    remotePlaceholder.style.display = 'flex';
    remotePlaceholder.textContent = 'Finding next stranger…';
    socket.emit('next', { mode });
  };
  if (skipOverlayBtn) skipOverlayBtn.onclick = () => nextBtn.onclick();

  stopBtn.onclick = () => {
    wantMatch = false;
    paired = false;
    if (socket) socket.emit('leave');
    cleanupPeer(false);
    stopLocalTracks();
    chat.classList.remove('active');
    landing.classList.add('active');
    setConn('idle');
  };
  if (endOverlayBtn) endOverlayBtn.onclick = () => stopBtn.onclick();

  reportBtn.onclick = () => {
    if (!socket) return;
    reportModal.classList.remove('hidden');
  };

  reportSubmit.onclick = () => {
    if (!socket) return;
    const reason = reportReason.value || 'other';
    const details = (reportDetails.value || '').trim().slice(0, 500);
    socket.emit('report', { reason, details });
    // Belt-and-suspenders: REST copy ensures an ackId even if socket drops.
    fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, details }),
    }).catch(() => {});
    sysMsg(`You reported the stranger (${reason}). Disconnected.`);
    cleanupPeer(false);
    remotePlaceholder.style.display = 'flex';
    remotePlaceholder.textContent = 'Reported. Press Next for a new chat.';
    reportDetails.value = '';
    reportModal.classList.add('hidden');
  };

  blockBtn.onclick = () => {
    if (!socket) return;
    paired = false;
    socket.emit('block');
    fetch('/api/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    sysMsg('You blocked the stranger. Disconnected — you will not match again.');
    cleanupPeer(false);
    remotePlaceholder.style.display = 'flex';
    remotePlaceholder.textContent = 'Blocked. Press Next for a new chat.';
  };

  privacyBtn.onclick = () => {
    privacyOut.classList.add('hidden');
    privacyOut.textContent = '';
    privacyModal.classList.remove('hidden');
  };

  dlData.onclick = async () => {
    try {
      const r = await fetch('/api/data-export');
      const j = await r.json();
      privacyOut.textContent = JSON.stringify(j, null, 2).slice(0, 6000);
      privacyOut.classList.remove('hidden');
    } catch { toast('Could not fetch data. Try again.'); }
  };

  delData.onclick = async () => {
    try {
      const r = await fetch('/api/data-delete', { method: 'POST' });
      const j = await r.json();
      privacyOut.textContent = JSON.stringify(j, null, 2);
      privacyOut.classList.remove('hidden');
      toast('Erasure request recorded. Safety/legal-hold records are retained per law.');
    } catch { toast('Could not submit erasure. Email tiloappcomplaints@protonmail.com.'); }
  };

  msgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = msgInput.value.trim().slice(0, 500);
    if (!v || !socket) return;
    addMsg('you', v);
    socket.emit('message', { text: v });
    socket.emit('typing', { isTyping: false });
    msgInput.value = '';
    msgInput.focus();
  });

  msgInput.addEventListener('input', () => {
    if (!socket) return;
    socket.emit('typing', { isTyping: msgInput.value.length > 0 });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('typing', { isTyping: false }), 1500);
  });

  muteBtn.onclick = () => {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !muted);
    muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  };
  camBtn.onclick = () => {
    camOff = !camOff;
    if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = !camOff);
    camBtn.textContent = camOff ? 'Cam On' : 'Cam Off';
  };

  // Pre-connect for online count (no media yet)
  ensureSocket();
})();
