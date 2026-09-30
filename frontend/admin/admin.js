(function () {
  'use strict';

  const API = '/api';
  let token = sessionStorage.getItem('admin_token') || null;
  let currentUser = null;

  const loginScreen = document.getElementById('login-screen');
  const appShell = document.getElementById('app-shell');

  // ---------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------
  async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.remove('active');

    try {
      const res = await fetch(`${API}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Login failed.';
        errEl.classList.add('active');
        return;
      }
      token = data.token;
      currentUser = data.user;
      sessionStorage.setItem('admin_token', token);
      enterApp();
    } catch {
      errEl.textContent = 'Could not reach the server. Please try again.';
      errEl.classList.add('active');
    }
  }

  function logout() {
    token = null;
    sessionStorage.removeItem('admin_token');
    appShell.classList.remove('active');
    loginScreen.style.display = 'flex';
  }

  function enterApp() {
    loginScreen.style.display = 'none';
    appShell.classList.add('active');
    document.getElementById('current-user').textContent = currentUser ? currentUser.name : 'Admin';
    loadDashboard();
  }

  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  document.getElementById('logout-btn').addEventListener('click', logout);

  async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      logout();
      throw new Error('Session expired.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || 'Request failed.');
    return data;
  }

  // ---------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------
  const pageLoaders = {
    dashboard: loadDashboard,
    appointments: loadAppointments,
    doctors: loadDoctors,
    services: loadServices,
    faqs: loadFaqs,
    conversations: loadConversations,
    settings: loadSettings,
  };

  document.querySelectorAll('.nav-link[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      document.getElementById(`page-${page}`).classList.add('active');
      pageLoaders[page] && pageLoaders[page]();
    });
  });

  // ---------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------
  async function loadDashboard() {
    try {
      const stats = await api('/admin/dashboard');
      document.getElementById('stat-grid').innerHTML = `
        ${statCard(stats.upcoming_count, 'Upcoming appointments')}
        ${statCard(stats.cancelled_count, 'Cancelled')}
        ${statCard(stats.new_patients_today, 'New patients today')}
        ${statCard(stats.ai_conversations, 'AI conversations')}
        ${statCard(stats.ai_bookings, 'AI bookings')}
        ${statCard(stats.human_handoffs, 'Human handoffs')}
      `;
      renderApptTable(document.getElementById('today-table-wrap'), stats.todays_appointments);
    } catch (err) {
      document.getElementById('stat-grid').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  function statCard(num, label) {
    return `<div class="stat-card"><div class="num">${num ?? 0}</div><div class="label">${label}</div></div>`;
  }

  // ---------------------------------------------------------------
  // Appointments
  // ---------------------------------------------------------------
  async function loadAppointments() {
    const date = document.getElementById('appt-date-filter').value;
    const status = document.getElementById('appt-status-filter').value;
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    try {
      const appts = await api(`/admin/appointments?${params.toString()}`);
      renderApptTable(document.getElementById('appt-table-wrap'), appts, true);
    } catch (err) {
      document.getElementById('appt-table-wrap').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }
  document.getElementById('appt-refresh').addEventListener('click', loadAppointments);
  document.getElementById('appt-date-filter').addEventListener('change', loadAppointments);
  document.getElementById('appt-status-filter').addEventListener('change', loadAppointments);

  function renderApptTable(container, appts, withActions) {
    if (!appts || appts.length === 0) {
      container.innerHTML = '<p class="empty-state">No appointments found.</p>';
      return;
    }
    container.innerHTML = `
      <table>
        <thead><tr><th>Booking</th><th>Patient</th><th>Doctor</th><th>Date</th><th>Time</th><th>Status</th>${withActions ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${appts.map((a) => `
            <tr>
              <td>${escapeHtml(a.booking_code)}</td>
              <td>${escapeHtml(a.patient_name)}<br><span style="color:var(--ink-faint);font-size:0.78rem;">${escapeHtml(a.patient_phone)}</span></td>
              <td>${escapeHtml(a.doctor_name)}</td>
              <td>${escapeHtml(a.appointment_date)}</td>
              <td>${escapeHtml(a.start_time)}</td>
              <td><span class="badge ${a.status}">${a.status.replace('_', ' ')}</span></td>
              ${withActions ? `<td>${a.status !== 'cancelled' ? `<button class="btn-small" data-cancel="${a.id}">Cancel</button>` : ''}</td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    if (withActions) {
      container.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Cancel this appointment?')) return;
          try {
            await fetch(`${API}/appointments/${btn.dataset.cancel}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ action: 'cancel' }),
            });
            loadAppointments();
          } catch (err) {
            alert(err.message);
          }
        });
      });
    }
  }

  // ---------------------------------------------------------------
  // Doctors
  // ---------------------------------------------------------------
  async function loadDoctors() {
    try {
      const doctors = await api('/admin/doctors');
      const wrap = document.getElementById('doctors-table-wrap');
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Name</th><th>Specialization</th><th>Duration</th><th>Status</th></tr></thead>
          <tbody>
            ${doctors.map((d) => `
              <tr>
                <td>${escapeHtml(d.name)}</td>
                <td>${escapeHtml(d.specialization)}</td>
                <td>${d.appointment_duration_minutes} min</td>
                <td><span class="badge ${d.active ? 'confirmed' : 'cancelled'}">${d.active ? 'Active' : 'Inactive'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p class="empty-state">Doctor creation, schedule editing, and holidays are available via the Admin API (PUT /api/admin/doctors/:id/schedule, POST /api/admin/doctors/:id/holidays). A full editing UI can be added here following the same table pattern.</p>
      `;
    } catch (err) {
      document.getElementById('doctors-table-wrap').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------
  async function loadServices() {
    try {
      const services = await api('/admin/services');
      const wrap = document.getElementById('services-table-wrap');
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Name</th><th>Duration</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>
            ${services.map((s) => `
              <tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${s.duration_minutes} min</td>
                <td>PKR ${Number(s.price).toLocaleString()}</td>
                <td><span class="badge ${s.active ? 'confirmed' : 'cancelled'}">${s.active ? 'Active' : 'Inactive'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      document.getElementById('services-table-wrap').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------
  // FAQs
  // ---------------------------------------------------------------
  async function loadFaqs() {
    try {
      const faqs = await api('/admin/faqs');
      const wrap = document.getElementById('faqs-table-wrap');
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Question</th><th>Answer</th></tr></thead>
          <tbody>
            ${faqs.map((f) => `<tr><td>${escapeHtml(f.question)}</td><td>${escapeHtml(f.answer)}</td></tr>`).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      document.getElementById('faqs-table-wrap').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------
  // Conversation logs
  // ---------------------------------------------------------------
  async function loadConversations() {
    try {
      const sessions = await api('/admin/conversations');
      const wrap = document.getElementById('conversations-table-wrap');
      if (sessions.length === 0) {
        wrap.innerHTML = '<p class="empty-state">No conversations yet.</p>';
        return;
      }
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Channel</th><th>Language</th><th>Status</th><th>Started</th></tr></thead>
          <tbody>
            ${sessions.map((s) => `
              <tr>
                <td>${escapeHtml(s.channel)}</td>
                <td>${escapeHtml(s.language)}</td>
                <td><span class="badge ${s.status === 'handoff' ? 'pending' : 'confirmed'}">${escapeHtml(s.status)}</span></td>
                <td>${escapeHtml(s.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      document.getElementById('conversations-table-wrap').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------
  async function loadSettings() {
    try {
      const info = await api('/admin/settings');
      const keys = ['clinic_name', 'address', 'phone', 'email', 'opening_hours', 'ai_receptionist_name'];
      const wrap = document.getElementById('settings-form-wrap');
      wrap.innerHTML = keys.map((k) => `
        <div class="field" style="max-width:480px;">
          <label>${k.replace(/_/g, ' ')}</label>
          <input type="text" data-key="${k}" value="${escapeHtml(info[k] || '')}">
        </div>
      `).join('') + '<button class="btn-small primary" id="save-settings">Save changes</button>';

      document.getElementById('save-settings').addEventListener('click', async () => {
        const inputs = wrap.querySelectorAll('input[data-key]');
        try {
          for (const input of inputs) {
            await api(`/admin/settings/${input.dataset.key}`, {
              method: 'PUT',
              body: JSON.stringify({ value: input.value }),
            });
          }
          alert('Settings saved.');
        } catch (err) {
          alert(err.message);
        }
      });
    } catch (err) {
      document.getElementById('settings-form-wrap').innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ---------------------------------------------------------------
  if (token) {
    // Verify existing token still works before showing the app.
    fetch(`${API}/admin/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.ok) {
          currentUser = { name: 'Admin' };
          enterApp();
        } else {
          logout();
        }
      })
      .catch(() => logout());
  }
})();
