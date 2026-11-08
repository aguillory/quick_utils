/**
 * Custom Lovelace Card: mail-intel-card
 * Home Assistant Smart Mail, USPS Digest Archive & AI Package Correlation System
 */

class MailIntelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._selectedDate = null;
    this._lightboxImg = null;
    this._isRefreshing = false;
  }

  setConfig(config) {
    this._config = {
      entity: 'sensor.mail_intel_dashboard_data',
      title: 'Mail & Package Intelligence',
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 6;
  }

  static getStubConfig() {
    return { entity: 'sensor.mail_intel_dashboard_data', title: 'Mail & Deliveries' };
  }

  formatDateLabel(dateStr, isToday, isYesterday) {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      const d = new Date(parts[0], parseInt(parts[1], 10) - 1, parts[2]);
      const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
      const month = d.toLocaleDateString('en-US', { month: 'short' });
      const day = d.getDate();
      if (isToday) return `Today - ${weekday}, ${month} ${day}`;
      if (isYesterday) return `Yesterday - ${weekday}, ${month} ${day}`;
      return `${weekday}, ${month} ${day}`;
    } catch (e) {
      return dateStr;
    }
  }

  getCarrierColor(carrier) {
    const c = (carrier || '').toUpperCase();
    if (c.includes('USPS')) return { bg: '#004B87', fg: '#FFFFFF' };
    if (c.includes('UPS')) return { bg: '#351C15', fg: '#FFB500' };
    if (c.includes('FEDEX')) return { bg: '#4D148C', fg: '#FF6600' };
    if (c.includes('AMAZON')) return { bg: '#232F3E', fg: '#FF9900' };
    if (c.includes('ALIEXPRESS') || c.includes('CAINIAO')) return { bg: '#E62E04', fg: '#FFFFFF' };
    if (c.includes('DHL')) return { bg: '#FFCC00', fg: '#D40511' };
    return { bg: 'var(--primary-color, #03a9f4)', fg: '#FFFFFF' };
  }

  handleScanNow() {
    if (!this._hass) return;
    this._isRefreshing = true;
    this.render();
    this._hass.callService('pyscript', 'mail_intel_scan_now', {})
      .then(() => {
        setTimeout(() => {
          this._isRefreshing = false;
          this.render();
        }, 1500);
      })
      .catch((err) => {
        console.error('mail_intel_scan_now error:', err);
        this._isRefreshing = false;
        this.render();
      });
  }

  openLightbox(url, title) {
    this._lightboxImg = { url, title };
    this.render();
  }

  closeLightbox() {
    this._lightboxImg = null;
    this.render();
  }

  render() {
    if (!this._hass || !this._config) return;

    const entityId = this._config.entity || 'sensor.mail_intel_dashboard_data';
    const stateObj = this._hass.states[entityId];

    const attrs = stateObj ? stateObj.attributes || {} : {};
    const daysData = attrs.days || {};
    const dates = Object.keys(daysData).sort().reverse(); // newest first
    const todayStr = dates[0] || new Date().toISOString().split('T')[0];

    if (!this._selectedDate || !dates.includes(this._selectedDate)) {
      this._selectedDate = todayStr;
    }

    const currentIndex = dates.indexOf(this._selectedDate);
    const isToday = this._selectedDate === todayStr;
    const isYesterday = dates.length > 1 && this._selectedDate === dates[1];

    const currentDayData = daysData[this._selectedDate] || { usps_images: [], deliveries: [] };
    const uspsImages = currentDayData.usps_images || [];
    const dayDeliveries = currentDayData.deliveries || [];

    const deliveringToday = attrs.delivering_today || [];
    const inTransit = attrs.in_transit || [];
    const recentDeliveries7d = attrs.recent_deliveries_7d || [];
    const lastUpdated = attrs.last_updated ? new Date(attrs.last_updated).toLocaleTimeString() : 'Never';

    // Build Package HTML card renderer
    const renderPackageCard = (pkg, highlight = false) => {
      const carrierColors = this.getCarrierColor(pkg.carrier);
      const trackingUrl = pkg.tracking_url || `https://t.17track.net/en#nums=${pkg.tracking_number}`;
      const emails = pkg.source_emails || [];
      const hasCorrelation = !!pkg.correlation_note;
      const isMasked = pkg.is_masked === 1;
      const maskIcon = isMasked ? 'mdi:eye-outline' : 'mdi:eye-off-outline';
      const maskTitle = isMasked ? 'Unmask item name' : 'Mask item name (Private)';

      return `
        <div class="package-card ${highlight ? 'highlight-delivering' : ''}" data-tracking="${pkg.tracking_number}">
          <div class="package-header">
            <span class="carrier-badge" style="background:${carrierColors.bg}; color:${carrierColors.fg};">
              ${pkg.carrier || 'Carrier'}
            </span>
            <a class="tracking-link" href="${trackingUrl}" target="_blank" rel="noopener noreferrer">
              <span>${pkg.tracking_number}</span>
              <ha-icon icon="mdi:open-in-new" style="--mdc-icon-size: 14px; margin-left: 2px;"></ha-icon>
            </a>
            <span class="status-pill status-${pkg.status || 'in_transit'}">
              ${(pkg.status || 'in_transit').replace('_', ' ')}
            </span>
            <div class="package-actions">
              <button class="action-btn btn-mask" data-tracking="${pkg.tracking_number}" title="${maskTitle}">
                <ha-icon icon="${maskIcon}" style="--mdc-icon-size: 16px;"></ha-icon>
              </button>
              <button class="action-btn btn-hide" data-tracking="${pkg.tracking_number}" title="Hide package from dashboard">
                <ha-icon icon="mdi:close" style="--mdc-icon-size: 16px;"></ha-icon>
              </button>
            </div>
          </div>

          <div class="package-body">
            <div class="merchant-line">
              <span class="merchant-name">${pkg.merchant_or_sender || 'Package Delivery'}</span>
              ${pkg.order_total ? `<span class="order-total">${pkg.order_total}</span>` : ''}
            </div>

            ${pkg.items_summary ? `
              <div class="items-summary">
                <ha-icon icon="mdi:package-variant-closed" style="--mdc-icon-size: 15px; color: var(--primary-color, #03a9f4); margin-right: 4px; flex-shrink: 0;"></ha-icon>
                <span>${pkg.items_summary}</span>
              </div>
            ` : ''}

            <div class="email-badges">
              ${emails.map(e => `<span class="email-badge" title="Received via ${e}"><ha-icon icon="mdi:email-outline" style="--mdc-icon-size: 12px; margin-right: 4px; vertical-align: middle;"></ha-icon>${e}</span>`).join('')}
            </div>

            ${hasCorrelation ? `
              <div class="correlation-box">
                <div class="correlation-header">
                  <ha-icon icon="mdi:link-variant" style="--mdc-icon-size: 14px; margin-right: 4px; color: #673ab7; vertical-align: middle;"></ha-icon>
                  <span class="correlation-title">AI Cross-Account Match</span>
                </div>
                <div class="correlation-desc">${pkg.correlation_note}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    };

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          font-family: var(--ha-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
        }
        ha-card {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          padding: 16px 24px;
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.08));
          color: var(--primary-text-color, #212121);
          overflow: hidden;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.1));
          padding-bottom: 12px;
        }
        .header-title {
          font-size: 1.3rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .header-icon {
          --mdc-icon-size: 26px;
          color: var(--primary-color, #03a9f4);
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn-refresh {
          background: var(--primary-color, #03a9f4);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: opacity 0.2s;
        }
        .btn-refresh:hover {
          opacity: 0.88;
        }
        .btn-refresh.refreshing ha-icon {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }

        /* Date Navigation Bar */
        .date-nav-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--secondary-background-color, rgba(0,0,0,0.04));
          border-radius: 8px;
          padding: 6px 12px;
          margin-bottom: 18px;
          gap: 8px;
        }
        .nav-btn {
          background: transparent;
          border: 1px solid var(--divider-color, rgba(0,0,0,0.15));
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          color: var(--primary-text-color);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }
        .nav-btn:hover:not(:disabled) {
          background: rgba(0,0,0,0.06);
        }
        .nav-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .date-select-wrapper {
          flex: 1;
          display: flex;
          justify-content: center;
        }
        select.date-select {
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.2));
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 0.92rem;
          font-weight: 500;
          cursor: pointer;
          width: 100%;
          max-width: 360px;
          outline: none;
        }
        .btn-today {
          background: var(--primary-color, #03a9f4);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
        }

        /* Section Headings */
        .section-heading {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 18px 0 10px 0;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--primary-text-color);
        }
        .section-icon {
          --mdc-icon-size: 20px;
        }
        .badge-count {
          background: var(--primary-color, #03a9f4);
          color: #fff;
          border-radius: 12px;
          padding: 2px 8px;
          font-size: 0.75rem;
          font-weight: bold;
        }

        /* USPS Images Grid - High-Res / Full-Width */
        .usps-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .usps-card {
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s;
          display: flex;
          flex-direction: column;
        }
        .usps-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        }
        .usps-card img {
          width: 100%;
          height: auto;
          max-height: 280px;
          object-fit: contain;
          background: #fdfdfd;
          display: block;
        }
        .usps-card-info {
          padding: 8px 12px;
          font-size: 0.8rem;
          color: var(--secondary-text-color, #666);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--secondary-background-color, rgba(0,0,0,0.02));
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.06));
        }
        .usps-account-badge {
          background: rgba(0,0,0,0.06);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.72rem;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Empty State */
        .empty-box {
          background: var(--secondary-background-color, rgba(0,0,0,0.03));
          border: 1px dashed var(--divider-color, rgba(0,0,0,0.15));
          border-radius: 8px;
          padding: 18px;
          text-align: center;
          color: var(--secondary-text-color, #777);
          font-size: 0.9rem;
          margin-bottom: 16px;
        }

        /* Packages Grid & Cards */
        .packages-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin-bottom: 18px;
        }
        .package-card {
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          border-radius: 8px;
          padding: 12px 16px;
          transition: box-shadow 0.15s;
        }
        .package-card.highlight-delivering {
          border-left: 4px solid var(--warning-color, #ff9800);
          background: rgba(255, 152, 0, 0.03);
        }
        .package-header {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .carrier-badge {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 4px;
          letter-spacing: 0.5px;
        }
        .tracking-link {
          font-size: 0.88rem;
          font-weight: 600;
          color: var(--primary-color, #03a9f4);
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .tracking-link:hover {
          text-decoration: underline;
        }
        .status-pill {
          margin-left: auto;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: capitalize;
          padding: 2px 8px;
          border-radius: 12px;
          background: var(--secondary-background-color, rgba(0,0,0,0.06));
          color: var(--secondary-text-color);
        }
        .status-delivering_today {
          background: #fff3e0;
          color: #e65100;
        }
        .status-delivered {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .status-in_transit {
          background: #e3f2fd;
          color: #1565c0;
        }
        .package-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: 6px;
        }
        .action-btn {
          background: transparent;
          border: 1px solid var(--divider-color, rgba(0,0,0,0.14));
          border-radius: 4px;
          padding: 2px 4px;
          cursor: pointer;
          color: var(--secondary-text-color, #757575);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.15s, color 0.15s, border-color 0.15s;
        }
        .action-btn:hover {
          background-color: var(--secondary-background-color, rgba(0, 0, 0, 0.08));
          color: var(--primary-text-color, #212121);
          border-color: var(--primary-color, #03a9f4);
        }
        .action-btn.btn-hide:hover {
          color: var(--error-color, #d32f2f);
          border-color: var(--error-color, #d32f2f);
        }
        .merchant-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.98rem;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .order-total {
          font-size: 0.88rem;
          font-weight: 700;
          color: #2e7d32;
        }
        .items-summary {
          font-size: 0.88rem;
          color: var(--secondary-text-color, #444);
          display: flex;
          align-items: center;
          margin-bottom: 6px;
        }
        .email-badges {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 6px;
        }
        .email-badge {
          background: var(--secondary-background-color, rgba(0,0,0,0.05));
          border: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.74rem;
          color: var(--secondary-text-color, #666);
          display: inline-flex;
          align-items: center;
        }
        .correlation-box {
          margin-top: 8px;
          background: rgba(103, 58, 183, 0.06);
          border: 1px solid rgba(103, 58, 183, 0.25);
          border-radius: 6px;
          padding: 8px 12px;
        }
        .correlation-header {
          display: flex;
          align-items: center;
          font-size: 0.8rem;
          font-weight: 700;
          color: #673ab7;
          margin-bottom: 2px;
        }
        .correlation-desc {
          font-size: 0.8rem;
          color: var(--primary-text-color);
        }

        /* Persistent Section C */
        .persistent-deliveries {
          margin-top: 22px;
          border-top: 2px dashed var(--divider-color, rgba(0,0,0,0.12));
          padding-top: 16px;
        }

        /* Footer */
        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.78rem;
          color: var(--secondary-text-color, #888);
          margin-top: 16px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          padding-top: 10px;
        }

        /* Lightbox Modal */
        .lightbox-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.88);
          z-index: 99999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          backdrop-filter: blur(4px);
        }
        .lightbox-content {
          max-width: 92%;
          max-height: 85%;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          object-fit: contain;
          background: #fff;
        }
        .lightbox-close-btn {
          position: absolute;
          top: 20px;
          right: 25px;
          background: rgba(255,255,255,0.25);
          color: #fff;
          border: none;
          border-radius: 50%;
          width: 44px;
          height: 44px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
        }
        .lightbox-close-btn:hover {
          background: rgba(255,255,255,0.45);
        }

        /* Responsive Mobile Layout */
        @media (max-width: 600px) {
          ha-card {
            padding: 12px 14px;
          }
          .usps-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <ha-card>
        <!-- Header -->
        <div class="header">
          <div class="header-title">
            <ha-icon class="header-icon" icon="mdi:mailbox-up-outline"></ha-icon>
            <span>${this._config.title || 'Smart Mail & Packages'}</span>
          </div>
          <div class="header-actions">
            ${!isToday ? `<button class="btn-today" id="btn-jump-today">Today</button>` : ''}
            <button class="btn-refresh ${this._isRefreshing ? 'refreshing' : ''}" id="btn-refresh">
              <ha-icon icon="mdi:refresh" style="--mdc-icon-size: 16px; margin-right: 4px;"></ha-icon>
              <span>${this._isRefreshing ? 'Scanning...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        <!-- 7-Day History Navigation Bar -->
        <div class="date-nav-bar">
          <button class="nav-btn" id="btn-prev-day" ${currentIndex >= dates.length - 1 ? 'disabled' : ''} title="Previous Day">
            <ha-icon icon="mdi:chevron-left" style="--mdc-icon-size: 18px;"></ha-icon>
          </button>
          <div class="date-select-wrapper">
            <select class="date-select" id="date-select">
              ${dates.map((dStr, idx) => {
                const dayObj = daysData[dStr] || { usps_images: [], deliveries: [] };
                const mailCount = dayObj.usps_images.length;
                const pkgCount = dayObj.deliveries.length;
                const label = this.formatDateLabel(dStr, idx === 0, idx === 1);
                const isSel = dStr === this._selectedDate ? 'selected' : '';
                return `<option value="${dStr}" ${isSel}>${label} (${mailCount} mail, ${pkgCount} pkgs)</option>`;
              }).join('')}
            </select>
          </div>
          <button class="nav-btn" id="btn-next-day" ${currentIndex <= 0 ? 'disabled' : ''} title="Next Day">
            <ha-icon icon="mdi:chevron-right" style="--mdc-icon-size: 18px;"></ha-icon>
          </button>
        </div>

        <!-- SECTION A: USPS Daily Digest Individual Mailpieces -->
        <div class="section-heading">
          <ha-icon class="section-icon" icon="mdi:email-mark-as-unread" style="color: var(--primary-color, #03a9f4);"></ha-icon>
          <span>USPS Informed Delivery Scans</span>
          <span class="badge-count">${uspsImages.length}</span>
        </div>

        ${uspsImages.length > 0 ? `
          <div class="usps-grid">
            ${uspsImages.map((img, i) => `
              <div class="usps-card" data-url="${img.url}">
                <img src="${img.url}" alt="USPS Mailpiece ${i+1}" loading="lazy" />
                <div class="usps-card-info">
                  <span>Piece #${i+1}</span>
                  <span class="usps-account-badge" title="${img.account_email}">${img.account_email}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-box">
            No USPS Informed Delivery mailpieces scanned for ${this.formatDateLabel(this._selectedDate, isToday, isYesterday)}.
          </div>
        `}

        <!-- SECTION B: Packages for Selected Date -->
        ${isToday ? `
          <!-- Today: Delivering Today -->
          <div class="section-heading">
            <ha-icon class="section-icon" icon="mdi:truck-delivery-outline" style="color: var(--warning-color, #ff9800);"></ha-icon>
            <span>Delivering Today</span>
            <span class="badge-count">${deliveringToday.length}</span>
          </div>
          ${deliveringToday.length > 0 ? `
            <div class="packages-grid">
              ${deliveringToday.map(p => renderPackageCard(p, true)).join('')}
            </div>
          ` : `
            <div class="empty-box">No deliveries scheduled to arrive today.</div>
          `}

          <!-- In Transit / Upcoming -->
          <div class="section-heading">
            <ha-icon class="section-icon" icon="mdi:package-variant" style="color: var(--info-color, #2196f3);"></ha-icon>
            <span>In Transit & Upcoming</span>
            <span class="badge-count">${inTransit.length}</span>
          </div>
          ${inTransit.length > 0 ? `
            <div class="packages-grid">
              ${inTransit.map(p => renderPackageCard(p)).join('')}
            </div>
          ` : `
            <div class="empty-box">No other packages currently in transit.</div>
          `}
        ` : `
          <!-- Past Date: Deliveries on Selected Date -->
          <div class="section-heading">
            <ha-icon class="section-icon" icon="mdi:check-circle-outline" style="color: var(--success-color, #4caf50);"></ha-icon>
            <span>Delivered on ${this.formatDateLabel(this._selectedDate, isToday, isYesterday)}</span>
            <span class="badge-count">${dayDeliveries.length}</span>
          </div>
          ${dayDeliveries.length > 0 ? `
            <div class="packages-grid">
              ${dayDeliveries.map(p => renderPackageCard(p)).join('')}
            </div>
          ` : `
            <div class="empty-box">No packages recorded as delivered on this date.</div>
          `}
        `}

        <!-- SECTION C: Persistent Recent Deliveries (Last 7 Days) -->
        <div class="persistent-deliveries">
          <div class="section-heading">
            <ha-icon class="section-icon" icon="mdi:package-variant-closed-check" style="color: #4caf50;"></ha-icon>
            <span>Recent Deliveries (Last 7 Days)</span>
            <span class="badge-count">${recentDeliveries7d.length}</span>
          </div>

          ${recentDeliveries7d.length > 0 ? `
            <div class="packages-grid">
              ${recentDeliveries7d.map(p => renderPackageCard(p)).join('')}
            </div>
          ` : `
            <div class="empty-box">No deliveries in the last 7 days.</div>
          `}
        </div>

        <!-- Footer -->
        <div class="card-footer">
          <span>Accounts: ${(attrs.accounts_monitored || []).length} connected</span>
          <span>Last Updated: ${lastUpdated}</span>
        </div>
      </ha-card>

      <!-- Lightbox Modal -->
      ${this._lightboxImg ? `
        <div class="lightbox-backdrop" id="lightbox-backdrop">
          <button class="lightbox-close-btn" id="lightbox-close" title="Close">
            <ha-icon icon="mdi:close" style="--mdc-icon-size: 26px; color: #fff;"></ha-icon>
          </button>
          <img class="lightbox-content" src="${this._lightboxImg.url}" alt="Mailpiece Full Resolution" />
        </div>
      ` : ''}
    `;

    // Attach Event Listeners
    const dateSelect = this.shadowRoot.getElementById('date-select');
    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => {
        this._selectedDate = e.target.value;
        this.render();
      });
    }

    const btnPrev = this.shadowRoot.getElementById('btn-prev-day');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (currentIndex < dates.length - 1) {
          this._selectedDate = dates[currentIndex + 1];
          this.render();
        }
      });
    }

    const btnNext = this.shadowRoot.getElementById('btn-next-day');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (currentIndex > 0) {
          this._selectedDate = dates[currentIndex - 1];
          this.render();
        }
      });
    }

    const btnToday = this.shadowRoot.getElementById('btn-jump-today');
    if (btnToday) {
      btnToday.addEventListener('click', () => {
        this._selectedDate = todayStr;
        this.render();
      });
    }

    const btnRefresh = this.shadowRoot.getElementById('btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this.handleScanNow());
    }

    // Mask / Unmask item name button click
    this.shadowRoot.querySelectorAll('.btn-mask').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tNum = btn.getAttribute('data-tracking');
        if (tNum && this._hass) {
          this._hass.callService('pyscript', 'mail_intel_toggle_mask', { package_key: tNum });
        }
      });
    });

    // Hide package button click
    this.shadowRoot.querySelectorAll('.btn-hide').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tNum = btn.getAttribute('data-tracking');
        if (tNum && this._hass) {
          this._hass.callService('pyscript', 'mail_intel_hide_package', { package_key: tNum });
        }
      });
    });

    // USPS Image card click for lightbox
    this.shadowRoot.querySelectorAll('.usps-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.getAttribute('data-url');
        this.openLightbox(url);
      });
    });

    // Close lightbox
    const lbClose = this.shadowRoot.getElementById('lightbox-close');
    if (lbClose) {
      lbClose.addEventListener('click', () => this.closeLightbox());
    }
    const lbBackdrop = this.shadowRoot.getElementById('lightbox-backdrop');
    if (lbBackdrop) {
      lbBackdrop.addEventListener('click', (e) => {
        if (e.target === lbBackdrop) {
          this.closeLightbox();
        }
      });
    }
  }
}

customElements.define('mail-intel-card', MailIntelCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'mail-intel-card',
  name: 'Mail & Package Intelligence Card',
  description: '7-day USPS Daily Digest mailpieces and AI-correlated package tracking across multiple accounts.',
  preview: true
});
