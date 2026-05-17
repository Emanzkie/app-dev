/**
 * admin-nav.js — Navigation utilities for the KinderCura Admin Dashboard
 * Auto-highlights the current nav link and provides nav helper functions.
 */

(function () {
  'use strict';

  /**
   * Highlights the nav-link whose href matches the current page path.
   * Handles both clean URLs (/admin/prc-verification) and full filenames
   * (/admin/admin-prc-verification.html) by comparing page identifiers.
   */
  function highlightCurrentNav() {
    var currentUrl = window.location.pathname.toLowerCase();
    var currentPage = currentUrl.split('/').pop().replace('.html', '');

    /* Extract base page name for clean URLs like /admin/prc-verification */
    var currentClean = currentPage;
    if (currentClean.startsWith('admin-')) {
      currentClean = currentClean.replace('admin-', '');
    }

    document.querySelectorAll('.main-nav .nav-link').forEach(function (link) {
      var linkHref = link.getAttribute('href');
      if (!linkHref) return;
      var linkPage = linkHref.split('/').pop().replace('.html', '');
      var linkClean = linkPage;
      if (linkClean.startsWith('admin-')) {
        linkClean = linkClean.replace('admin-', '');
      }

      var isMatch = (linkPage === currentPage) || (linkClean === currentClean) || (linkHref === currentUrl);
      if (isMatch) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  /**
   * Ensures the "PRC Verification" nav link exists.
   * If missing from the current page's nav, it injects it after the Users link.
   */
  function ensurePrcNavLink() {
    var nav = document.querySelector('.main-nav');
    if (!nav) return;
    var existing = nav.querySelector('a[href*="prc-verification"]');
    if (existing) return;

    var usersLink = nav.querySelector('a[href*="users"]');
    if (!usersLink) return;

    var prcLink = document.createElement('a');
    prcLink.href = '/admin/prc-verification';
    prcLink.className = 'nav-link';
    prcLink.textContent = 'PRC Verification';
    usersLink.parentNode.insertBefore(prcLink, usersLink.nextSibling);
  }

  /**
   * Run on DOMContentLoaded to highlight nav and inject PRC link if needed.
   */
  function initAdminNav() {
    highlightCurrentNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminNav);
  } else {
    initAdminNav();
  }

  // Export helpers for external use
  window.adminNav = {
    highlightCurrentNav: highlightCurrentNav,
    ensurePrcNavLink: ensurePrcNavLink
  };

})();
