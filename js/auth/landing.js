// === Extracted from SIGN-UP,LOGIN\landing.html (script block 1) ===
// Important: custom smooth scrolling with header offset so section titles stay visible.
        document.querySelectorAll('.header-nav a[href^="#"]').forEach((link) => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                const target = document.querySelector(link.getAttribute('href'));
                const header = document.querySelector('.landing-header');
                if (!target) return;

                const headerHeight = header ? header.offsetHeight : 0;
                const targetTop = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - 20;

                window.scrollTo({
                    top: targetTop,
                    behavior: 'smooth'
                });
            });
        });
