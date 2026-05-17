/**
 * notifications.js — PRC Verification Notification Integration
 * Extends the existing KinderCura notification system to handle
 * PRC verification requests: redirects to the verification page
 * with the specific pediatrician ID, and auto-opens the modal.
 *
 * Relies on api.js (notificationDestination) and
 * notifications-card-ui.js (notificationTarget) being loaded first.
 */

(function () {
  'use strict';

  /**
   * Checks if a notification is a PRC verification request.
   * Matches on title, message, and type fields.
   */
  function isPrcVerificationNotification(notification) {
    var title = String(notification && notification.title || '').toLowerCase();
    var message = String(notification && notification.message || '').toLowerCase();
    var type = String(notification && notification.type || '').toLowerCase();
    var relatedPage = String(notification && notification.relatedPage || '').toLowerCase();

    if (relatedPage.includes('prc-verification') || relatedPage.includes('prc')) return true;

    return (
      title.includes('prc') ||
      title.includes('verification') ||
      title.includes('license') ||
      title.includes('pediatrician registration') ||
      message.includes('prc verification') ||
      message.includes('new pediatrician registration') ||
      message.includes('license verification') ||
      type === 'prc_verification'
    );
  }

  /**
   * Extracts the pediatrician ID from a notification.
   * Looks in relatedId, then tries to parse from the message.
   */
  function extractPediatricianId(notification) {
    if (!notification) return null;

    if (notification.relatedId) {
      var parsed = parseInt(notification.relatedId, 10);
      if (!isNaN(parsed)) return parsed;
      return notification.relatedId;
    }

    var message = String(notification.message || '');
    var match = message.match(/\b(?:ID|id|#):?\s*(\d+)\b/);
    if (match) return parseInt(match[1], 10);

    var title = String(notification.title || '');
    match = title.match(/\b(?:ID|id|#):?\s*(\d+)\b/);
    if (match) return parseInt(match[1], 10);

    return null;
  }

  /**
   * Build the PRC verification page URL, optionally including the pediatrician ID.
   */
  function buildPrcVerificationUrl(pediatricianId) {
    var base = '/admin/prc-verification';
    if (pediatricianId != null) {
      return base + '?pediatricianId=' + encodeURIComponent(pediatricianId);
    }
    return base;
  }

  /**
   * Hook into the notification destination logic.
   * If the notification is PRC-related, return the verification page URL.
   * This is called by both api.js's notificationDestination and
   * notifications-card-ui.js's notificationTarget.
   */
  function prcNotificationDestination(notification) {
    if (isPrcVerificationNotification(notification)) {
      return buildPrcVerificationUrl(extractPediatricianId(notification));
    }
    return null;
  }

  /**
   * Monkey-patches the existing notificationDestination and notificationTarget
   * functions to add PRC verification routing. This is safe because:
   * - The original function is called first; if it returns a non-default path, we use it.
   * - If it returns the default admin dashboard, we check for PRC-related content.
   */
  function patchNotificationRouting() {
    // Patch api.js notificationDestination
    if (typeof window.notificationDestination === 'function') {
      var originalDestination = window.notificationDestination;
      window.notificationDestination = function (notification) {
        var prcUrl = prcNotificationDestination(notification);
        if (prcUrl) return prcUrl;
        return originalDestination(notification);
      };
    }

    // Patch notifications-card-ui.js notificationTarget
    if (typeof window.notificationTarget === 'function') {
      var originalTarget = window.notificationTarget;
      window.notificationTarget = function (notification) {
        var prcUrl = prcNotificationDestination(notification);
        if (prcUrl) return prcUrl;
        return originalTarget(notification);
      };
    }
  }

  /**
   * Add a sample PRC verification notification for testing.
   */
  function addSamplePrcNotification() {
    if (!window.KC_SAMPLE_NOTIFICATIONS) return;

    var existing = window.KC_SAMPLE_NOTIFICATIONS.some(function (n) {
      return String(n.title || '').toLowerCase().includes('prc');
    });

    if (existing) return;

    window.KC_SAMPLE_NOTIFICATIONS.unshift({
      id: 'sample-prc-101',
      title: 'New PRC Verification Request',
      message: 'Dr. Maria Santos (ID: 101) has submitted documents for PRC license verification.',
      type: 'prc_verification',
      relatedId: 101,
      relatedPage: '/admin/prc-verification?pediatricianId=101',
      isRead: false,
      createdAt: new Date().toISOString()
    });
  }

  // ── Initialization ─────────────────────────────────────────────

  function init() {
    patchNotificationRouting();

    // Only add sample in non-production environments
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      addSamplePrcNotification();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for external use
  window.prcNotifications = {
    isPrcVerificationNotification: isPrcVerificationNotification,
    extractPediatricianId: extractPediatricianId,
    buildPrcVerificationUrl: buildPrcVerificationUrl,
    prcNotificationDestination: prcNotificationDestination
  };

})();
