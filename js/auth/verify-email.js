// === Extracted from SIGN-UP,LOGIN\verify-email.html (script block 1) ===
let resendTimer = 60;
        let timerRunning = false;

        function moveToNext(current, nextId) {
            const value = current.value;
            if (!/^\d$/.test(value)) { current.value = ''; return; }
            current.classList.add('filled');
            if (nextId && value) document.getElementById(nextId).focus();
            if (nextId === null && value) {
                setTimeout(() => {
                    const otp = ['otp1','otp2','otp3','otp4'].map(id => document.getElementById(id).value).join('');
                    if (otp.length === 4) document.getElementById('otp-form').dispatchEvent(new Event('submit'));
                }, 300);
            }
        }

        function handleBackspace(e, current, prevId) {
            if (e.key === 'Backspace' && !current.value && prevId) {
                const prev = document.getElementById(prevId);
                prev.value = '';
                prev.classList.remove('filled');
                prev.focus();
            }
        }

        function verifyOTP(event) {
            event.preventDefault();
            const otp = ['otp1','otp2','otp3','otp4'].map(id => document.getElementById(id).value).join('');
            if (otp.length !== 4) { alert('Please enter all 4 digits of the PIN'); return; }
            // Backend: POST /api/auth/verify-pin { email, pin: otp }
            alert('Email verified successfully! Welcome to KinderCura.');
            const userRole = sessionStorage.getItem('userRole') || 'parent';
            if (userRole === 'parent') {
                window.location.href = '../SIGN-UP,LOGIN/screening.html';
            } else if (userRole === 'pediatrician') {
                window.location.href = '/pedia/pediatrician-dashboard.html';
            }
        }

        function resendOTP() {
            if (timerRunning) return;
            // Backend: POST /api/auth/resend-pin { email }
            alert('A new 4-digit PIN has been sent to your Gmail!');
            resendTimer = 60;
            startTimer();
        }

        function startTimer() {
            timerRunning = true;
            updateTimer();
        }

        function updateTimer() {
            const timerEl = document.getElementById('timer');
            if (resendTimer > 0) {
                timerEl.textContent = `(${resendTimer}s)`;
                resendTimer--;
                setTimeout(updateTimer, 1000);
            } else {
                timerEl.textContent = '';
                timerRunning = false;
            }
        }

        window.addEventListener('load', () => {
            const email = sessionStorage.getItem('userEmail') || 'your-email@gmail.com';
            document.getElementById('email-display').textContent = email;
            startTimer();
        });
