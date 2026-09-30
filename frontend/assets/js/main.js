(function () {
  'use strict';

  const API = '/api';

  // ---------------------------------------------------------------
  // Clinic content (services, doctors, FAQ) — loaded from the real API
  // ---------------------------------------------------------------
  async function loadClinicContent() {
    try {
      const [services, doctors, clinic] = await Promise.all([
        fetch(`${API}/services`).then((r) => r.json()),
        fetch(`${API}/doctors`).then((r) => r.json()),
        fetch(`${API}/clinic`).then((r) => r.json()),
      ]);
      renderServices(services);
      renderDoctors(doctors);
      renderFaq(clinic.faqs || []);
    } catch (err) {
      console.error('Failed to load clinic content', err);
    }
  }

  function renderServices(services) {
    const el = document.getElementById('service-list');
    el.innerHTML = services.map((s) => `
      <div class="service-row">
        <h3>${escapeHtml(s.name)}</h3>
        <p>${escapeHtml(s.description || '')}</p>
        <span class="service-meta">${s.duration_minutes} min</span>
        <span class="service-price">PKR ${Number(s.price).toLocaleString()}</span>
      </div>
    `).join('');
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function renderDoctors(doctors) {
    const el = document.getElementById('doctor-grid');
    el.innerHTML = doctors.map((d) => `
      <div class="doctor-card">
        <div class="doctor-avatar">${initials(d.name)}</div>
        <h3>${escapeHtml(d.name)}</h3>
        <div class="spec">${escapeHtml(d.specialization)}</div>
        <p class="bio">${escapeHtml(d.bio || '')}</p>
        <div class="doctor-schedule" data-doctor-id="${d.id}">Loading schedule…</div>
      </div>
    `).join('');

    doctors.forEach(loadDoctorSchedule);
  }

  async function loadDoctorSchedule(doctor) {
    const target = document.querySelector(`.doctor-schedule[data-doctor-id="${doctor.id}"]`);
    if (!target) return;
    try {
      const { windows } = await fetch(`${API}/doctors/${doctor.id}/schedule`).then((r) => r.json());
      if (!windows || windows.length === 0) {
        target.textContent = 'Schedule not yet set.';
        return;
      }
      const byDay = {};
      windows.forEach((w) => {
        byDay[w.day_of_week] = byDay[w.day_of_week] || [];
        byDay[w.day_of_week].push(`${w.start_time}–${w.end_time}`);
      });
      const summary = Object.keys(byDay)
        .sort((a, b) => a - b)
        .map((d) => `${DAY_NAMES[d]} ${byDay[d].join(', ')}`)
        .join(' · ');
      target.textContent = summary;
    } catch {
      target.textContent = '';
    }
  }

  function initials(name) {
    return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  function renderFaq(faqs) {
    const el = document.getElementById('faq-list');
    el.innerHTML = faqs.map((f, i) => `
      <div class="faq-item" data-idx="${i}">
        <button class="faq-q" aria-expanded="false">
          <span>${escapeHtml(f.question)}</span>
          <span class="icon" aria-hidden="true">+</span>
        </button>
        <div class="faq-a"><div class="faq-a-inner">${escapeHtml(f.answer)}</div></div>
      </div>
    `).join('');

    el.querySelectorAll('.faq-item').forEach((item) => {
      const btn = item.querySelector('.faq-q');
      btn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        el.querySelectorAll('.faq-item.open').forEach((i) => {
          i.classList.remove('open');
          i.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ---------------------------------------------------------------
  // AI Receptionist widget (voice + chat, shared session/backend)
  // ---------------------------------------------------------------
  const overlay = document.getElementById('rp-overlay');
  const transcriptEl = document.getElementById('transcript');
  const apptSlot = document.getElementById('appt-card-slot');
  const errorEl = document.getElementById('rp-error');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const micBtn = document.getElementById('mic-btn');
  const endBtn = document.getElementById('end-btn');
  const orb = document.getElementById('rp-orb');
  const hint = document.getElementById('rp-hint');
  const voicePanel = document.getElementById('voice-panel');
  const chatInputRow = document.getElementById('chat-input-row');
  const chatText = document.getElementById('chat-text');
  const chatSend = document.getElementById('chat-send');
  const modeVoiceBtn = document.getElementById('mode-voice-btn');
  const modeChatBtn = document.getElementById('mode-chat-btn');

  let sessionId = null;
  let currentChannel = 'voice';
  let currentLanguage = 'en';
  let recognizing = false;
  let recognition = null;

  function setStatus(state, label) {
    statusDot.className = 'status-dot' + (state ? ' ' + state : '');
    statusText.textContent = label;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('active');
  }
  function clearError() {
    errorEl.classList.remove('active');
    errorEl.textContent = '';
  }

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    transcriptEl.appendChild(div);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function addSystemNote(text) {
    addMessage('system', text);
  }

  async function openWidget(channel) {
    overlay.classList.add('active');
    clearError();
    transcriptEl.innerHTML = '';
    apptSlot.innerHTML = '';
    setMode(channel);
    setStatus('connected', 'Connecting…');

    try {
      const res = await fetch(`${API}/ai/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, language: currentLanguage }),
      });
      if (!res.ok) throw new Error('session_failed');
      const data = await res.json();
      sessionId = data.id;
      setStatus('connected', 'Connected');
      addSystemNote(channel === 'voice' ? 'Tap the microphone and say hello.' : 'Say hello to get started.');
    } catch (err) {
      setStatus('', 'Connection failed');
      showError("Sorry, I'm having trouble connecting right now. Please try again or contact the clinic directly.");
    }
  }

  function closeWidget() {
    overlay.classList.remove('active');
    stopRecognition();
    window.speechSynthesis && window.speechSynthesis.cancel();
    sessionId = null;
    setStatus('', 'Idle');
  }

  function setMode(channel) {
    currentChannel = channel;
    if (channel === 'voice') {
      modeVoiceBtn.classList.add('active');
      modeChatBtn.classList.remove('active');
      voicePanel.style.display = '';
      chatInputRow.style.display = 'none';
    } else {
      modeChatBtn.classList.add('active');
      modeVoiceBtn.classList.remove('active');
      voicePanel.style.display = 'none';
      chatInputRow.style.display = 'flex';
    }
  }

  document.getElementById('open-voice').addEventListener('click', () => openWidget('voice'));
  document.getElementById('open-voice-2').addEventListener('click', () => openWidget('voice'));
  document.getElementById('open-chat').addEventListener('click', () => openWidget('chat'));
  document.getElementById('rp-close').addEventListener('click', closeWidget);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWidget(); });
  modeVoiceBtn.addEventListener('click', () => setMode('voice'));
  modeChatBtn.addEventListener('click', () => setMode('chat'));
  endBtn.addEventListener('click', closeWidget);

  // ---- Sending a message to the AI agent (shared by voice + chat) ----
  async function sendToAgent(text) {
    if (!sessionId) return;
    addMessage('user', text);
    clearError();
    setStatus('connected', 'Thinking…');

    try {
      const res = await fetch(`${API}/ai/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Sorry, I'm having trouble connecting right now. Please try again or contact the clinic directly.");
        setStatus('connected', 'Connected');
        return;
      }

      addMessage('ai', data.text);
      renderToolEvents(data.toolEvents || []);
      setStatus('connected', 'Connected');

      if (currentChannel === 'voice') {
        speak(data.text);
      }
    } catch (err) {
      showError("Sorry, I'm having trouble connecting right now. Please try again or contact the clinic directly.");
      setStatus('connected', 'Connected');
    }
  }

  function renderToolEvents(events) {
    for (const evt of events) {
      if (evt.name === 'book_appointment' && evt.result && evt.result.id) {
        renderApptCard(evt.result);
      }
      if (evt.name === 'reschedule_appointment' && evt.result && evt.result.id) {
        renderApptCard(evt.result);
      }
      if (evt.name === 'handoff_to_human') {
        addSystemNote('This conversation has been flagged for clinic staff.');
      }
    }
  }

  function renderApptCard(appt) {
    apptSlot.innerHTML = `
      <div class="appt-card">
        <h4>Appointment ${appt.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}</h4>
        <div class="appt-row"><span class="label">Doctor</span><span class="value">${escapeHtml(appt.doctor_name || '')}</span></div>
        <div class="appt-row"><span class="label">Date</span><span class="value">${escapeHtml(appt.appointment_date || '')}</span></div>
        <div class="appt-row"><span class="label">Time</span><span class="value">${escapeHtml(appt.start_time || '')}</span></div>
        <div class="appt-row"><span class="label">Booking ID</span><span class="value">${escapeHtml(appt.booking_code || '')}</span></div>
        <div class="appt-actions">
          <a class="primary" href="${API}/appointments/${appt.id}/ics" download>Add to Calendar</a>
        </div>
      </div>
    `;
  }

  // ---- Chat input ----
  chatSend.addEventListener('click', submitChat);
  chatText.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitChat(); });
  function submitChat() {
    const val = chatText.value.trim();
    if (!val) return;
    chatText.value = '';
    sendToAgent(val);
  }

  // ---- Voice: Web Speech API (STT) ----
  // This is the default, zero-config voice provider. To use a
  // production STT/TTS vendor instead (Deepgram, ElevenLabs, etc.),
  // implement the same startRecognition/stopRecognition/speak
  // interface against that provider's SDK — call sites don't change.
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  function startRecognition() {
    if (!SpeechRecognitionImpl) {
      showError('Voice input is not supported in this browser. Please use text chat instead.');
      return;
    }
    recognition = new SpeechRecognitionImpl();
    recognition.lang = langToLocale(currentLanguage);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add('recording');
      orb.classList.add('listening');
      hint.textContent = 'Listening…';
      setStatus('listening', 'Listening');
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      stopRecognition();
      sendToAgent(text);
    };

    recognition.onerror = (event) => {
      stopRecognition();
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        showError('Sorry, I had trouble hearing you. Please try again.');
      }
    };

    recognition.onend = () => {
      stopRecognition();
    };

    try {
      recognition.start();
    } catch {
      // already started — ignore
    }
  }

  function stopRecognition() {
    recognizing = false;
    micBtn.classList.remove('recording');
    orb.classList.remove('listening');
    hint.textContent = 'Tap the microphone and say hello.';
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
  }

  micBtn.addEventListener('click', () => {
    if (recognizing) {
      stopRecognition();
    } else {
      startRecognition();
    }
  });

  // ---- Voice: SpeechSynthesis (TTS) ----
  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = langToLocale(currentLanguage);
    utter.rate = 1.02;
    orb.classList.add('speaking');
    hint.textContent = 'Speaking…';
    setStatus('speaking', 'Speaking');
    utter.onend = () => {
      orb.classList.remove('speaking');
      hint.textContent = 'Tap the microphone and say hello.';
      setStatus('connected', 'Connected');
    };
    window.speechSynthesis.speak(utter);
  }

  function langToLocale(lang) {
    if (lang === 'ur') return 'ur-PK';
    return 'en-US';
  }

  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', loadClinicContent);
})();
