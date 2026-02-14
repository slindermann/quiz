// ─── Registration Client Logic ───────────────────────────────

let registrationEmail = '';

// Load logo
(function() {
  const logo = document.getElementById('regLogo');
  const img = new Image();
  img.onload = () => { logo.src = img.src; logo.classList.remove('hidden'); };
  img.src = '/api/favicon';
})();

document.getElementById('btnRequestCode').addEventListener('click', requestCode);
document.getElementById('regEmail').addEventListener('keydown', e => {
  if (e.key === 'Enter') requestCode();
});
document.getElementById('btnVerifyCode').addEventListener('click', verifyCode);
document.getElementById('regCode').addEventListener('keydown', e => {
  if (e.key === 'Enter') verifyCode();
});

async function requestCode() {
  const email = document.getElementById('regEmail').value.trim();
  const errorEl = document.getElementById('emailError');
  errorEl.textContent = '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = t('invalidEmail');
    return;
  }

  const btn = document.getElementById('btnRequestCode');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/register/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      errorEl.textContent = data.error || 'Error';
      btn.disabled = false;
      btn.textContent = t('sendCode');
      return;
    }

    registrationEmail = email;
    document.getElementById('stepEmail').classList.add('hidden');
    document.getElementById('stepCode').classList.remove('hidden');
    document.getElementById('codeSentMsg').textContent = t('codeSentTo').replace('{email}', email);
    document.getElementById('regCode').focus();
  } catch (e) {
    errorEl.textContent = e.message || 'Error';
    btn.disabled = false;
    btn.textContent = t('sendCode');
  }
}

async function verifyCode() {
  const code = document.getElementById('regCode').value.trim();
  const errorEl = document.getElementById('codeError');
  errorEl.textContent = '';

  if (!code || code.length !== 6) {
    errorEl.textContent = t('enterValidCode');
    return;
  }

  const btn = document.getElementById('btnVerifyCode');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registrationEmail, code })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      errorEl.textContent = data.error || 'Error';
      btn.disabled = false;
      btn.textContent = t('verify');
      return;
    }

    document.getElementById('stepCode').classList.add('hidden');
    document.getElementById('stepSuccess').classList.remove('hidden');
  } catch (e) {
    errorEl.textContent = e.message || 'Error';
    btn.disabled = false;
    btn.textContent = t('verify');
  }
}
