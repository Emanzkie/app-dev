// === Extracted from PARENT\settings.html (script block 1) ===
function switchTab(tab) {
            // Hide all tabs
            document.querySelectorAll('[id$="-tab"]').forEach(el => el.style.display = 'none');
            // Show selected tab
            document.getElementById(tab + '-tab').style.display = 'block';
            
            // Update button styles
            document.querySelectorAll('.settings-tab').forEach(btn => {
                btn.style.background = 'transparent';
                btn.style.color = 'var(--text-light)';
            });
            event.target.style.background = 'var(--bg-primary)';
            event.target.style.color = 'var(--text-dark)';
        }

        function toggleProfileMenu() {
            const menu = document.getElementById('profileMenu');
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        }

        function openNotifications() {
            document.getElementById('notificationsModal').style.display = 'flex';
        }

        function closeNotifications() {
            document.getElementById('notificationsModal').style.display = 'none';
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.profile-btn')) {
                document.getElementById('profileMenu').style.display = 'none';
            }
        });
