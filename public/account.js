(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const api = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  };
  let currentUser = null;
  let authChecked = false;
  let guestAccess = false;
  const pendingActivity = [];
  let accountMode = 'register';
  let prompt;
  const storageGet = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
  const storageSet = (storage, key, value) => { try { storage.setItem(key, value); } catch {} };

  async function refreshAccess() {
    try {
      const data = await api('/api/access');
      guestAccess = data.guestAccess === true;
    } catch { guestAccess = false; }
  }

  function addStyles() {
    if (document.querySelector('#c1-account-styles')) return;
    const style = document.createElement('style');
    style.id = 'c1-account-styles';
    style.textContent = `
      .c1-account-button{border:1px solid var(--line);background:var(--surface);color:var(--brand);border-radius:10px;padding:8px 12px;font-weight:750;cursor:pointer;font-size:13px;transition:all 180ms ease}.c1-account-button:hover{background:var(--surface-2);border-color:#b9cbbf}
      .c1-account-overlay{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(14,24,17,.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}.c1-account-overlay.open{display:flex}
      .c1-account-card{width:min(100%,440px);max-height:calc(100vh - 36px);overflow:auto;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 18px 48px rgba(14,24,17,.22);border-radius:20px;padding:28px}
      .c1-account-card h2{font-size:24px;letter-spacing:-.03em;margin:0 0 8px;font-weight:800}.c1-account-card p{color:var(--muted);font-size:13.5px;line-height:1.55}.c1-account-card form{display:grid;gap:14px;margin-top:18px}.c1-account-card label{font-weight:750;font-size:12px;display:grid;gap:6px;color:var(--ink)}.c1-account-card input:not([type=checkbox]){width:100%;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);padding:11px 13px;font-size:14px;transition:all 180ms ease}.c1-account-card input:focus,.c1-comment input:focus,.c1-comment textarea:focus{outline:2.5px solid var(--brand);outline-offset:1px;border-color:var(--brand)}.c1-account-card .c1-consent{display:flex;align-items:flex-start;gap:9px;font-weight:500;line-height:1.5;font-size:12.5px}.c1-account-card .c1-consent input{margin-top:3px;accent-color:var(--brand)}.c1-account-card a{color:var(--brand)}
      .c1-account-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.c1-account-actions button,.c1-account-card form button{border:1px solid var(--line);background:var(--surface);color:var(--brand);border-radius:10px;padding:10px 14px;font-weight:750;font-size:13px;cursor:pointer;transition:all 180ms ease}.c1-account-actions button:hover{background:var(--surface-2);border-color:#b9cbbf}.c1-account-actions .c1-primary,.c1-account-card form .c1-primary{background:var(--brand);color:#fff;border-color:var(--brand)}.c1-account-actions .c1-primary:hover,.c1-account-card form .c1-primary:hover{background:var(--brand-dark);border-color:var(--brand-dark)}.c1-account-error{color:#a33232!important;min-height:18px;font-size:12.5px;font-weight:600}.c1-account-footer{font-size:11.5px!important;line-height:1.55;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;margin-top:16px}
      .comments,.c1-comments{margin:40px 0 32px;border-top:1px solid var(--line);padding-top:28px}.comments h2,.c1-comments h2{font-size:22px;letter-spacing:-.03em;margin:0 0 16px;font-weight:750}.c1-comment-list{display:grid;gap:12px}.c1-comment{border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:15px;box-shadow:0 1px 3px rgba(0,0,0,.02)}.c1-comment strong{font-size:13.5px;font-weight:700}.c1-comment time{font-size:11.5px;color:var(--muted);margin-left:8px;font-weight:500}.c1-comment p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font-size:14px;line-height:1.6}
      .c1-comment-form,.comments form{margin-top:22px;display:grid;gap:12px;max-width:720px}.c1-comment-form label,.comments form label{font-size:12.5px;font-weight:750;display:grid;gap:6px;color:var(--ink)}.c1-comment input,.c1-comment textarea,.comments input,.comments textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);padding:11px 13px;font-size:14px;transition:all 180ms ease}.c1-comment textarea,.comments textarea{min-height:96px;resize:vertical;line-height:1.55}.c1-comment-form button,.comments form button{justify-self:start;border:1px solid var(--brand);border-radius:10px;background:var(--brand);color:#fff;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer;transition:all 180ms ease}.c1-comment-form button:hover,.comments form button:hover{background:var(--brand-dark);border-color:var(--brand-dark)}.c1-comment-note,.comment-note{font-size:11.5px!important;color:var(--muted);line-height:1.5}.c1-comment-message{font-size:12.5px;color:var(--muted)}
      @media(max-width:600px){.c1-account-card{padding:22px 18px;border-radius:18px}.c1-account-overlay{align-items:flex-start;padding-top:6vh}.c1-account-button{padding:6px 9px;font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  let pendingOtpEmail = '';

  function buildPrompt() {
    if (prompt) return prompt;
    prompt = document.createElement('div');
    prompt.className = 'c1-account-overlay';
    prompt.id = 'c1-account-overlay';
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-modal', 'true');
    prompt.setAttribute('aria-labelledby', 'c1-account-title');
    prompt.innerHTML = `<section class="c1-account-card">
      <div data-account-view="form">
        <h2 id="c1-account-title"></h2>
        <p data-account-intro></p>
        <form id="c1-account-form">
          <label>Name<input name="name" autocomplete="name" minlength="2" maxlength="80" required></label>
          <label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <label>Mobile no.<input name="phone" type="tel" autocomplete="tel" inputmode="tel" pattern="[+0-9 ()-]{7,20}" maxlength="20" required></label>
          <label class="c1-consent" data-account-consent><input name="termsAccepted" type="checkbox" required><span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms and Conditions</a> and have read the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
          <button class="c1-primary" type="submit"></button>
        </form>
        <form id="c1-otp-form" hidden style="display:grid;gap:12px;margin-top:16px">
          <p style="font-size:13px;color:var(--muted);margin:0">Enter the 6-digit code sent to <strong id="c1-otp-recipient"></strong>.</p>
          <label>Verification Code<input name="otp" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required style="font-size:20px;letter-spacing:4px;text-align:center"></label>
          <button class="c1-primary" type="submit">Verify & Sign in</button>
          <button type="button" id="c1-resend-otp" style="border:0;background:transparent;color:var(--brand);cursor:pointer;text-decoration:underline;font-size:12px">Resend code</button>
        </form>
        <p class="c1-account-error" role="alert" aria-live="polite"></p>
        <div class="c1-account-actions">
          <button type="button" data-account-switch></button>
          <button type="button" data-account-guest>Continue as guest</button>
        </div>
        <p class="c1-account-footer">We record account IP addresses and site activity for security and administration. Verification codes are sent to your email. <a href="/privacy">Privacy</a></p>
      </div>
      <div data-account-view="signed-in" hidden>
        <h2 id="c1-account-signed-title">Your account</h2>
        <p data-account-welcome></p>
        <div class="c1-account-actions">
          <button type="button" data-account-logout>Sign out</button>
          <button type="button" data-account-close>Close</button>
        </div>
      </div>
    </section>`;
    const form = prompt.querySelector('#c1-account-form');
    const nameLabel = form.querySelector('[name="name"]').closest('label');
    nameLabel.dataset.accountNameField = '1';
    const phoneLabel = form.querySelector('[name="phone"]').closest('label');
    phoneLabel.firstChild.textContent = 'Mobile no.';
    const locationLabel = document.createElement('label');
    locationLabel.dataset.accountLocationField = '1';
    locationLabel.innerHTML = 'Location (optional)<input name="location" autocomplete="address-level2" maxlength="100" placeholder="City or area">';
    phoneLabel.after(locationLabel);

    prompt.addEventListener('click', event => { if (event.target === prompt && currentUser) closePrompt(); });
    prompt.querySelector('[data-account-switch]').addEventListener('click', () => setMode(accountMode === 'register' ? 'login' : 'register'));
    prompt.querySelector('[data-account-guest]').addEventListener('click', closePrompt);
    prompt.querySelector('[data-account-close]').addEventListener('click', closePrompt);
    prompt.querySelector('[data-account-logout]').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await api('/api/account/logout', { method: 'POST', body: '{}' }); currentUser = null; storageSet(localStorage, 'c1-account-created', '1'); updateCommentForms(); openPrompt('login'); }
      catch (error) { prompt.querySelector('.c1-account-error').textContent = error.message; }
      finally { event.currentTarget.disabled = false; }
    });
    prompt.querySelector('#c1-account-form').addEventListener('submit', submitAccount);
    prompt.querySelector('#c1-otp-form').addEventListener('submit', submitOtp);
    prompt.querySelector('#c1-resend-otp').addEventListener('click', resendOtp);
    document.body.appendChild(prompt);
    return prompt;
  }

  function setMode(mode) {
    accountMode = mode;
    const root = buildPrompt();
    root.querySelector('[data-account-view="form"]').hidden = false;
    root.querySelector('[data-account-view="signed-in"]').hidden = true;
    root.querySelector('#c1-account-form').hidden = false;
    root.querySelector('#c1-otp-form').hidden = true;
    root.querySelector('.c1-account-actions').hidden = false;
    root.setAttribute('aria-labelledby', 'c1-account-title');
    root.querySelector('#c1-account-title').textContent = mode === 'register' ? 'Create your account' : 'Log in';
    root.querySelector('[data-account-intro]').textContent = mode === 'register' ? (guestAccess ? 'Create a simple account to join the discussion. Browsing is also available as a guest.' : 'Register to access the Citizen One guides. Your name is collected only during registration.') : 'Enter your registered email address to receive a 6-digit login code.';
    const guestButton = root.querySelector('[data-account-guest]');
    guestButton.hidden = !guestAccess;
    guestButton.disabled = !guestAccess;
    const nameField = root.querySelector('[name="name"]');
    nameField.closest('label').hidden = mode !== 'register';
    nameField.disabled = mode !== 'register';
    nameField.required = mode === 'register';
    const phoneField = root.querySelector('[name="phone"]');
    phoneField.closest('label').hidden = mode !== 'register';
    phoneField.disabled = mode !== 'register';
    phoneField.required = mode === 'register';
    const locationField = root.querySelector('[name="location"]');
    locationField.closest('label').hidden = mode !== 'register';
    locationField.disabled = mode !== 'register';
    root.querySelector('[data-account-consent]').hidden = mode !== 'register';
    root.querySelector('[data-account-consent] input').required = mode === 'register';
    root.querySelector('[data-account-consent] input').checked = false;
    root.querySelector('#c1-account-form button[type="submit"]').textContent = mode === 'register' ? 'Continue with OTP' : 'Send login code';
    root.querySelector('[data-account-switch]').textContent = mode === 'register' ? 'Already registered? Log in' : 'Create an account';
    root.querySelector('.c1-account-error').textContent = '';
    root.querySelector('#c1-account-form').reset();
    root.querySelector('#c1-otp-form').reset();
  }

  function showOtpView(email) {
    pendingOtpEmail = email;
    const root = buildPrompt();
    root.querySelector('#c1-account-form').hidden = true;
    root.querySelector('#c1-otp-form').hidden = false;
    root.querySelector('.c1-account-actions').hidden = true;
    root.querySelector('#c1-account-title').textContent = 'Enter verification code';
    root.querySelector('[data-account-intro]').textContent = '';
    root.querySelector('#c1-otp-recipient').textContent = email;
    root.querySelector('.c1-account-error').textContent = '';
    root.querySelector('[name="otp"]').focus();
  }

  async function resendOtp() {
    if (!pendingOtpEmail) return;
    prompt.querySelector('.c1-account-error').textContent = '';
    try {
      await api('/api/account/login', { method: 'POST', body: JSON.stringify({ email: pendingOtpEmail }) });
      prompt.querySelector('.c1-account-error').style.color = 'var(--brand)';
      prompt.querySelector('.c1-account-error').textContent = 'A new code has been sent to your email.';
    } catch (error) {
      prompt.querySelector('.c1-account-error').style.color = '#a33232';
      prompt.querySelector('.c1-account-error').textContent = error.message;
    }
  }

  async function submitOtp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const otp = form.elements.otp.value.trim();
    button.disabled = true;
    prompt.querySelector('.c1-account-error').textContent = '';
    try {
      const result = await api('/api/account/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: pendingOtpEmail, otp })
      });
      currentUser = result.user;
      storageSet(localStorage, 'c1-account-created', '1');
      if (document.querySelector('.access-gate')) { window.location.reload(); return; }
      closePrompt();
      updateCommentForms();
      const articleId = location.pathname.startsWith('/guides/') ? decodeURIComponent(location.pathname.slice('/guides/'.length)) : location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
      window.CitizenOneAccount.track(articleId ? 'guide_view' : 'page_view', articleId ? `Viewed guide: ${articleId}` : `Viewed ${location.pathname}`);
    } catch (error) {
      prompt.querySelector('.c1-account-error').style.color = '#a33232';
      prompt.querySelector('.c1-account-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
  function openPrompt(mode = null) {
    const root = buildPrompt();
    if (currentUser) {
      root.querySelector('[data-account-view="form"]').hidden = true;
      root.querySelector('[data-account-view="signed-in"]').hidden = false;
      root.setAttribute('aria-labelledby', 'c1-account-signed-title');
      root.querySelector('[data-account-welcome]').textContent = `You are signed in as ${currentUser.name}.`;
    } else setMode(mode || (storageGet(localStorage, 'c1-account-created') === '1' ? 'login' : 'register'));
    root.classList.add('open');
    const first = root.querySelector('[data-account-view="form"]:not([hidden]) input, [data-account-view="signed-in"]:not([hidden]) button');
    first?.focus();
  }

  function closePrompt() {
    prompt?.classList.remove('open');
    storageSet(sessionStorage, 'c1-account-prompt-dismissed', '1');
  }

  async function submitAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    data.termsAccepted = form.elements.termsAccepted ? form.elements.termsAccepted.checked : true;
    button.disabled = true;
    prompt.querySelector('.c1-account-error').textContent = '';
    try {
      const result = await api(accountMode === 'register' ? '/api/account/register' : '/api/account/login', { method: 'POST', body: JSON.stringify(data) });
      if (result.requireOtp) {
        showOtpView(data.email);
        return;
      }
      currentUser = result.user;
      if (accountMode === 'register') storageSet(localStorage, 'c1-account-created', '1');
      if (document.querySelector('.access-gate')) { window.location.reload(); return; }
      closePrompt();
      updateCommentForms();
      const articleId = location.pathname.startsWith('/guides/') ? decodeURIComponent(location.pathname.slice('/guides/'.length)) : location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
      window.CitizenOneAccount.track(articleId ? 'guide_view' : 'page_view', articleId ? `Viewed guide: ${articleId}` : `Viewed ${location.pathname}`);
    } catch (error) { prompt.querySelector('.c1-account-error').textContent = error.message; }
    finally { button.disabled = false; }
  }

  function track(type, detail) {
    if (!authChecked) { pendingActivity.push({ type, detail }); return; }
    if (!currentUser) return;
    fetch('/api/activity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, detail }) }).catch(() => {});
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  async function initComments(root = document) {
    for (const section of root.querySelectorAll('[data-comments-article]')) {
      const articleId = section.dataset.commentsArticle;
      const list = section.querySelector('[data-comments-list]');
      const form = section.querySelector('[data-comment-form]');
      if (!list || !form || section.dataset.ready === '1') continue;
      section.dataset.ready = '1';
      const nameField = form.querySelector('[name="name"]');
      const textField = form.querySelector('[name="text"]');
      const submit = form.querySelector('button[type="submit"]');
      const status = document.createElement('p');
      status.className = 'c1-comment-message';
      form.appendChild(status);
      async function refresh() {
        try {
          const data = await api(`/api/comments?articleId=${encodeURIComponent(articleId)}`);
          currentUser = data.user;
          updateFormIdentity(form);
          list.innerHTML = data.comments.length ? `<div class="c1-comment-list">${data.comments.map(comment => `<article class="c1-comment"><strong>${esc(comment.name)}</strong><time>${esc(formatDate(comment.createdAt))}${comment.updatedAt && comment.updatedAt !== comment.createdAt ? ' · edited' : ''}</time><p>${esc(comment.text)}</p></article>`).join('')}</div>` : '<p class="c1-comment-note">No comments yet. Start a respectful discussion.</p>';
          const locked = data.locked;
          form.hidden = locked;
          let closed = section.querySelector('[data-comments-closed]');
          if (locked && !closed) { closed = document.createElement('p'); closed.dataset.commentsClosed = '1'; closed.className = 'c1-comment-note'; closed.textContent = 'Comments are closed for this guide.'; form.before(closed); }
          if (!locked) closed?.remove();
        } catch { list.innerHTML = '<p class="c1-comment-note">Comments could not be loaded. Refresh and try again.</p>'; }
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = '';
        try {
          await api('/api/comments', { method: 'POST', body: JSON.stringify({ articleId, name: nameField.value, text: textField.value }) });
          textField.value = '';
          status.textContent = 'Your comment was posted.';
          await refresh();
        } catch (error) { status.textContent = error.message; }
        finally { submit.disabled = false; }
      });
      await refresh();
    }
  }

  function updateFormIdentity(form) {
    const nameField = form.querySelector('[name="name"]');
    const nameWrap = form.querySelector('.comment-guest-name');
    if (!nameField || !nameWrap) return;
    if (currentUser) { nameField.value = currentUser.name; nameWrap.hidden = true; nameField.required = false; }
    else { nameWrap.hidden = false; nameField.required = true; }
  }

  function updateCommentForms() {
    document.querySelectorAll('[data-comment-form]').forEach(updateFormIdentity);
  }

  function addAccountButton() {
    const nav = document.querySelector('#site-nav');
    if (!nav || nav.querySelector('.c1-account-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'c1-account-button';
    button.textContent = 'Account';
    button.addEventListener('click', () => {
      nav.classList.remove('open');
      document.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
      openPrompt();
    });
    nav.appendChild(button);
  }

  async function init() {
    addStyles();
    addAccountButton();
    await refreshAccess();
    await initComments();
    try {
      const data = await api('/api/account/me');
      currentUser = data.user;
    } catch { currentUser = null; }
    authChecked = true;
    while (pendingActivity.length) { const event = pendingActivity.shift(); track(event.type, event.detail); }
    updateCommentForms();
    if (currentUser) {
      const articleId = location.pathname.startsWith('/guides/') ? decodeURIComponent(location.pathname.slice('/guides/'.length)) : location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
      track(articleId ? 'guide_view' : 'page_view', articleId ? `Viewed guide: ${articleId}` : `Viewed ${location.pathname}`);
    } else {
      const dismissed = storageGet(sessionStorage, 'c1-account-prompt-dismissed') === '1';
      if (!dismissed && !['/privacy', '/terms'].includes(location.pathname)) openPrompt();
    }
  }

  window.CitizenOneAccount = { initComments, track, open: openPrompt };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
