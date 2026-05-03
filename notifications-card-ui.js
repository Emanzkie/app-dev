(() => {
    const sampleNotificationData = [
        {
            id: 'sample-appointment',
            title: 'Appointment reminder',
            message: 'Your upcoming appointment details are ready to review.',
            type: 'appointment',
            relatedPage: '/parent/appointments.html',
            isRead: false,
            createdAt: new Date().toISOString()
        },
        {
            id: 'sample-results',
            title: 'Assessment review completed',
            message: 'A pediatrician has completed a review for the latest assessment.',
            type: 'assessment',
            relatedPage: '/parent/results.html',
            isRead: true,
            createdAt: new Date(Date.now() - 3600000).toISOString()
        }
    ];

    window.KC_SAMPLE_NOTIFICATIONS = window.KC_SAMPLE_NOTIFICATIONS || sampleNotificationData;

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));

    const fmt = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const getModal = () => document.getElementById('notificationsModal');
    const getList = () => document.getElementById('notificationsList') || document.querySelector('#notificationsModal .notifications-list');
    const getClearButton = () => document.getElementById('clearNotificationsBtn');
    const canUseApi = () => typeof window.apiFetch === 'function';

    function notificationTarget(n) {
        if (typeof window.notificationDestination === 'function') return window.notificationDestination(n);
        const related = String(n?.relatedPage || '').trim();
        if (related) return related;

        const path = window.location.pathname.toLowerCase();
        const role = String(window.KC?.user?.()?.role || '').toLowerCase();
        const title = String(n?.title || '').toLowerCase();
        const type = String(n?.type || '').toLowerCase();
        const msg = String(n?.message || '').toLowerCase();

        if (role === 'admin' || path.includes('/admin/')) {
            if (title.includes('user') || msg.includes('user')) return '/admin/admin-users.html';
            if (title.includes('report') || msg.includes('report')) return '/admin/admin-reports.html';
            if (title.includes('training') || msg.includes('training')) return '/admin/admin-training.html';
            if (title.includes('setting') || msg.includes('setting')) return '/admin/admin-settings.html';
            return '/admin/admin-dashboard.html';
        }

        if (role === 'pediatrician' || path.includes('/pedia/')) {
            if (type === 'chat' || title.includes('message') || msg.includes('message from')) return '/pedia/pedia-chat.html';
            if (type === 'appointment' || title.includes('appointment') || msg.includes('appointment')) return '/pedia/pediatrician-appointments.html';
            if (title.includes('question') || type === 'assessment') return '/pedia/pedia-questions.html';
            if (title.includes('diagnosis') || title.includes('review') || title.includes('recommendation')) return '/pedia/pediatrician-patients.html';
            return '/pedia/pediatrician-dashboard.html';
        }

        if (title.includes('review completed') || title.includes('diagnosis') || msg.includes('diagnosis') || msg.includes('open results')) return '/parent/results.html';
        if (title.includes('recommendation') || msg.includes('recommendation')) return '/parent/recommendations.html';
        if (type === 'appointment' || title.includes('appointment') || msg.includes('appointment')) return '/parent/appointments.html';
        if (type === 'chat' || title.includes('message') || msg.includes('message from')) return '/parent/chat.html';
        if (type === 'assessment' || title.includes('question') || msg.includes('question')) return '/parent/custom-questions.html';
        return '/parent/dashboard.html';
    }

    function notificationIcon(n) {
        const text = `${n?.type || ''} ${n?.title || ''}`.toLowerCase();
        if (text.includes('appointment')) return 'A';
        if (text.includes('message') || text.includes('chat')) return 'M';
        if (text.includes('question')) return 'Q';
        if (text.includes('diagnosis') || text.includes('assessment') || text.includes('review')) return 'R';
        return '!';
    }

    async function refreshCount() {
        if (typeof window.loadNotificationCount === 'function') {
            try {
                await window.loadNotificationCount();
                return;
            } catch {}
        }

        if (!canUseApi()) return;
        try {
            const data = await window.apiFetch('/notifications/count');
            const badge = document.querySelector('.notification-badge');
            if (badge) {
                const unread = data.unread || 0;
                badge.textContent = unread;
                badge.style.display = unread > 0 ? 'flex' : 'none';
            }
        } catch {}
    }

    async function loadNotifications() {
        if (window.KC_USE_SAMPLE_NOTIFICATIONS || !canUseApi()) return sampleNotificationData;
        const data = await window.apiFetch('/notifications');
        return Array.isArray(data.notifications) ? data.notifications : [];
    }

    async function markRead(id) {
        if (!id || !canUseApi() || String(id).startsWith('sample-')) return;
        try {
            await window.apiFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT' });
        } catch {}
        await refreshCount();
    }

    function renderNotifications(notifications) {
        const list = getList();
        const clearButton = getClearButton();
        if (!list) return;

        const items = Array.isArray(notifications)
            ? notifications.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            : [];
        if (clearButton) clearButton.disabled = items.length === 0;

        if (!items.length) {
            list.innerHTML = '<p class="notifications-empty">No notifications yet.</p>';
            return;
        }

        list.innerHTML = items.map((n) => {
            const id = String(n.id ?? n._id ?? '');
            const target = notificationTarget(n);
            const unreadClass = n.isRead ? '' : ' unread';
            return `
                <article class="notification-card${unreadClass}" role="listitem" data-card-id="${esc(id)}">
                    <div class="notification-card-main" tabindex="0" role="button" data-notification-id="${esc(id)}" data-notification-target="${esc(target)}" aria-label="Open notification">
                        <span class="notif-icon" aria-hidden="true">${esc(notificationIcon(n))}</span>
                        <div class="notif-content">
                            <p class="notif-title">${esc(n.title || 'Notification')}</p>
                            <p class="notif-preview">${esc(n.message || '')}</p>
                            <p class="notif-time">${esc(fmt(n.createdAt))}</p>
                            <span class="notif-open-link" data-open-notification-id="${esc(id)}" data-open-target="${esc(target)}">Open related page -&gt;</span>
                        </div>
                    </div>
                    <button type="button" class="notif-delete" data-delete-notification-id="${esc(id)}" aria-label="Delete notification">X</button>
                </article>`;
        }).join('');
    }

    async function reloadModal() {
        const list = getList();
        if (!list) return;
        list.innerHTML = '<p class="notifications-empty">Loading...</p>';

        try {
            const notifications = await loadNotifications();
            renderNotifications(notifications);
            if (canUseApi() && notifications.some((n) => !n.isRead)) {
                window.apiFetch('/notifications/read-all', { method: 'PUT' }).then(refreshCount).catch(() => {});
            }
        } catch {
            list.innerHTML = '<p class="notifications-empty">Could not load notifications.</p>';
            const clearButton = getClearButton();
            if (clearButton) clearButton.disabled = true;
        }
    }

    window.openNotifications = async function openNotifications() {
        const modal = getModal();
        if (!modal) return;
        modal.classList.add('is-open');
        modal.style.display = 'flex';
        modal.onclick = (event) => {
            if (event.target === modal) window.closeNotifications();
        };
        await reloadModal();
    };

    window.closeNotifications = function closeNotifications() {
        const modal = getModal();
        if (!modal) return;
        modal.classList.remove('is-open', 'show');
        modal.style.display = 'none';
    };

    window.clearAllNotifications = async function clearAllNotifications() {
        const clearButton = getClearButton();
        if (clearButton) clearButton.disabled = true;

        try {
            if (canUseApi()) {
                try {
                    await window.apiFetch('/notifications/all', { method: 'DELETE' });
                } catch {
                    await window.apiFetch('/notifications/clear-all', { method: 'DELETE' });
                }
            }
            await refreshCount();
            await reloadModal();
        } catch (err) {
            alert('Could not clear notifications: ' + err.message);
            if (clearButton) clearButton.disabled = false;
        }
    };

    window.deleteNotification = async function deleteNotification(element) {
        const button = element && typeof element.closest === 'function' ? element.closest('[data-delete-notification-id]') : null;
        const id = button ? button.getAttribute('data-delete-notification-id') : String(element || '');
        if (!id) return;

        try {
            if (canUseApi() && !id.startsWith('sample-')) {
                await window.apiFetch(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
            }
            const card = Array.from(document.querySelectorAll('[data-card-id]')).find((item) => item.getAttribute('data-card-id') === id);
            if (card) card.remove();
            await refreshCount();
            await reloadModal();
        } catch (err) {
            alert('Could not delete notification: ' + err.message);
        }
    };

    window.navigateTo = async function navigateTo(page, notificationId) {
        await markRead(notificationId);
        if (!page) return;
        if (typeof window.applyNotificationContext === 'function') window.applyNotificationContext(page);
        window.location.href = page;
    };

    document.addEventListener('click', async (event) => {
        const deleteButton = event.target.closest('#notificationsModal [data-delete-notification-id]');
        if (deleteButton) {
            event.preventDefault();
            event.stopPropagation();
            await window.deleteNotification(deleteButton);
            return;
        }

        const openLink = event.target.closest('#notificationsModal [data-open-notification-id]');
        if (openLink) {
            event.preventDefault();
            event.stopPropagation();
            await window.navigateTo(openLink.getAttribute('data-open-target'), openLink.getAttribute('data-open-notification-id'));
            return;
        }

        const cardMain = event.target.closest('#notificationsModal [data-notification-id]');
        if (cardMain) {
            await window.navigateTo(cardMain.getAttribute('data-notification-target'), cardMain.getAttribute('data-notification-id'));
        }
    });

    document.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const cardMain = event.target.closest('#notificationsModal [data-notification-id]');
        if (!cardMain) return;
        event.preventDefault();
        await window.navigateTo(cardMain.getAttribute('data-notification-target'), cardMain.getAttribute('data-notification-id'));
    });
})();
