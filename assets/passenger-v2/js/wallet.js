/* ============================================================
   ASIYE PASSENGER V2
   Wallet + FNB PayShap Request-to-Pay client
   ============================================================

   SECURITY RULE:
   This file NEVER credits a wallet directly. It only asks the
   authenticated Asiye backend to create/query a payment request.
   The backend must confirm payment with FNB and perform the
   idempotent wallet ledger/balance update.
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.wallet = {
    pollTimer: null,
    balanceRef: null,
    balanceHandler: null,

    config() {
        return window.ASIYE_CONFIG?.payshap || {};
    },

    apiBase() {
        const configured = String(this.config().apiBase || '').trim();

        if (configured) {
            return configured.replace(/\/$/, '');
        }

        /*
         * Hosted web builds can default to same-origin.
         * Flutter asset/WebView builds must set payshap.apiBase
         * to the public HTTPS Asiye backend URL.
         */
        if (/^https?:$/.test(window.location.protocol)) {
            return window.location.origin;
        }

        return '';
    },

    endpoint(kind, requestId = '') {
        const cfg = this.config();
        const createPath = cfg.createRequestPath || '/api/wallet/payshap/requests';
        const statusPath = cfg.requestStatusPath || '/api/wallet/payshap/requests';
        const path = kind === 'create'
            ? createPath
            : `${statusPath.replace(/\/$/, '')}/${encodeURIComponent(requestId)}`;

        const base = this.apiBase();

        if (!base) {
            throw new Error(
                'PayShap is not configured for this app build. Set ASIYE_CONFIG.payshap.apiBase to the Asiye HTTPS payment backend.'
            );
        }

        return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    },

    money(value) {
        return Number.isFinite(Number(value))
            ? `R${Number(value).toFixed(2)}`
            : 'R0.00';
    },

    escape(value) {
        return String(value ?? '').replace(
            /[&<>"']/g,
            c => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[c])
        );
    },

    async getIdToken() {
        const user = firebase?.auth?.().currentUser;

        if (!user) {
            throw new Error('Please sign in again before adding money.');
        }

        return user.getIdToken();
    },

    async request(url, options = {}) {
        const token = await this.getIdToken();

        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(options.body ? {'Content-Type': 'application/json'} : {}),
                ...(options.headers || {})
            },
            body: options.body
                ? JSON.stringify(options.body)
                : undefined
        });

        let payload = null;

        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (!response.ok) {
            const error = new Error(
                payload?.message ||
                payload?.error ||
                `Payment service returned HTTP ${response.status}.`
            );

            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        return payload || {};
    },

    async createTopup(amount) {
        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            throw new Error('Enter a valid top-up amount.');
        }

        /*
         * The authenticated backend derives the wallet owner and
         * payer identity from the verified Firebase ID token/profile.
         * Do not trust a commuterId or phone supplied by the client.
         */
        return this.request(
            this.endpoint('create'),
            {
                method: 'POST',
                body: {
                    amount: Number(numericAmount.toFixed(2)),
                    currency: 'ZAR'
                }
            }
        );
    },

    async getTopup(requestId) {
        if (!requestId) {
            throw new Error('Payment request reference is missing.');
        }

        return this.request(
            this.endpoint('status', requestId)
        );
    },

    normaliseStatus(value) {
        return String(value || 'pending')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
    },

    statusText(status) {
        const value = this.normaliseStatus(status);

        const labels = {
            pending: 'Waiting for approval',
            created: 'Request sent',
            requested: 'Request sent',
            processing: 'Processing payment',
            paid: 'Payment received',
            credited: 'Wallet credited',
            success: 'Wallet credited',
            failed: 'Payment failed',
            rejected: 'Payment declined',
            declined: 'Payment declined',
            cancelled: 'Payment cancelled',
            expired: 'Payment request expired'
        };

        return labels[value] || value.replace(/_/g, ' ');
    },

    statusClass(status) {
        const value = this.normaliseStatus(status);

        if (['credited', 'success'].includes(value)) return 'success';
        if (['failed', 'rejected', 'declined', 'cancelled', 'expired'].includes(value)) return 'error';

        return 'pending';
    },

    isFinal(status) {
        return [
            'credited',
            'success',
            'failed',
            'rejected',
            'declined',
            'cancelled',
            'expired'
        ].includes(this.normaliseStatus(status));
    },

    updateStatus(container, data) {
        const status = this.normaliseStatus(data?.status);
        const box = container?.querySelector('[data-wallet-status]');

        if (!box) return;

        box.className = `wallet-payment-status ${this.statusClass(status)}`;

        const reference = data?.reference || data?.id || data?.requestId || '';

        box.innerHTML = `
            <div class="wallet-status-icon">
                <i class="fas ${
                    this.statusClass(status) === 'success'
                        ? 'fa-circle-check'
                        : this.statusClass(status) === 'error'
                            ? 'fa-circle-exclamation'
                            : 'fa-circle-notch fa-spin'
                }"></i>
            </div>
            <div>
                <strong>${this.escape(this.statusText(status))}</strong>
                <p>${
                    status === 'paid'
                        ? 'FNB has confirmed payment. Asiye is finalising the wallet credit.'
                        : this.statusClass(status) === 'success'
                            ? 'Your Asiye Wallet has been credited automatically.'
                            : this.statusClass(status) === 'error'
                                ? this.escape(data?.message || 'This payment request did not complete.')
                                : 'Approve the PayShap Request-to-Pay in your banking app. This screen will update automatically.'
                }</p>
                ${reference ? `<small>Reference: ${this.escape(reference)}</small>` : ''}
            </div>
        `;

        const balance = Number(data?.balance);

        if (Number.isFinite(balance)) {
            this.updateDisplayedBalance(container, balance);
        }
    },

    updateDisplayedBalance(container, value) {
        const balance = Number(value);

        if (!Number.isFinite(balance)) return;

        const target = container?.querySelector('[data-wallet-balance]');

        if (target) {
            target.textContent = this.money(balance);
        }

        ASIYE.state.user = {
            ...(ASIYE.state.user || {}),
            credits: balance,
            walletBalance: balance
        };
    },

    async poll(requestId, container) {
        this.stopPolling();

        const cfg = this.config();
        const intervalMs = Math.max(
            2000,
            Number(cfg.pollIntervalMs || 3000)
        );

        let finished = false;

        const check = async () => {
            try {
                const data = await this.getTopup(requestId);
                this.updateStatus(container, data);

                if (this.isFinal(data?.status)) {
                    finished = true;
                    this.stopPolling();

                    if (
                        ['credited', 'success'].includes(
                            this.normaliseStatus(data?.status)
                        )
                    ) {
                        ASIYE.ui?.toast?.('Wallet credited successfully.');
                    }
                }
            } catch (error) {
                console.warn('PayShap status check failed:', error);
            }
        };

        await check();

        if (!finished) {
            this.pollTimer = window.setInterval(
                check,
                intervalMs
            );
        }
    },

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    watchBalance(commuterId, container) {
        this.stopBalanceWatch();

        if (!commuterId || !firebase?.database) return;

        this.balanceRef = firebase
            .database()
            .ref(`commuters/${commuterId}`);

        this.balanceHandler = snapshot => {
            const profile = snapshot.val() || {};

            ASIYE.state.user = {
                ...(ASIYE.state.user || {}),
                ...profile
            };

            const balance = Number(
                profile.walletBalance ??
                profile.credits
            );

            if (Number.isFinite(balance)) {
                this.updateDisplayedBalance(
                    container,
                    balance
                );
            }
        };

        this.balanceRef.on(
            'value',
            this.balanceHandler,
            error => console.warn('Wallet balance listener failed:', error)
        );
    },

    stopBalanceWatch() {
        if (this.balanceRef && this.balanceHandler) {
            this.balanceRef.off(
                'value',
                this.balanceHandler
            );
        }

        this.balanceRef = null;
        this.balanceHandler = null;
    },

    stop() {
        this.stopPolling();
        this.stopBalanceWatch();
    },

    async render(container, context = {}) {
        if (!container) return;

        this.stop();

        const user = context.user || ASIYE.state.user || {};
        const commuterId = context.commuterId || ASIYE.state.userId;
        const configured = Boolean(this.apiBase());

        container.innerHTML = `
            <div class="member-balance">
                <small>Available wallet balance</small>
                <strong data-wallet-balance>
                    ${this.money(user.walletBalance ?? user.credits ?? 0)}
                </strong>
            </div>

            <section class="wallet-topup">
                <div class="wallet-topup-heading">
                    <div>
                        <span>Instant wallet top-up</span>
                        <h2>Add money with PayShap</h2>
                    </div>
                    <div class="wallet-payshap-mark">PayShap</div>
                </div>

                <p class="member-note">
                    Enter an amount and Asiye will send a PayShap Request-to-Pay.
                    Approve it in your banking app and your wallet will update automatically
                    after the payment is confirmed.
                </p>

                <label class="wallet-amount-label" for="walletTopupAmount">
                    Amount
                </label>

                <div class="wallet-amount-field">
                    <span>R</span>
                    <input
                        id="walletTopupAmount"
                        inputmode="decimal"
                        type="number"
                        min="1"
                        step="0.01"
                        placeholder="100.00"
                        autocomplete="off"
                    >
                </div>

                <div class="wallet-quick-amounts" aria-label="Quick top-up amounts">
                    ${[50, 100, 200, 500].map(amount => `
                        <button type="button" data-wallet-amount="${amount}">
                            R${amount}
                        </button>
                    `).join('')}
                </div>

                <button
                    type="button"
                    class="member-primary wallet-request-button"
                    data-wallet-request
                    ${configured ? '' : 'disabled'}
                >
                    <i class="fas fa-bolt"></i>
                    Request payment
                </button>

                <p class="wallet-security-note">
                    <i class="fas fa-shield-halved"></i>
                    Bank credentials are never stored in the Asiye app.
                </p>

                <div data-wallet-status></div>

                ${
                    configured
                        ? ''
                        : `<div class="wallet-payment-status error">
                            <div class="wallet-status-icon">
                                <i class="fas fa-plug-circle-xmark"></i>
                            </div>
                            <div>
                                <strong>Payment service not configured</strong>
                                <p>Set ASIYE_CONFIG.payshap.apiBase to the Asiye HTTPS payment backend for this build.</p>
                            </div>
                        </div>`
                }
            </section>
        `;

        const input = container.querySelector('#walletTopupAmount');
        const button = container.querySelector('[data-wallet-request]');

        container
            .querySelectorAll('[data-wallet-amount]')
            .forEach(quickButton => {
                quickButton.addEventListener('click', () => {
                    input.value = quickButton.dataset.walletAmount;
                    input.focus();
                });
            });

        if (button) {
            button.addEventListener('click', async () => {
                const amount = Number(input?.value);

                if (!Number.isFinite(amount) || amount <= 0) {
                    ASIYE.ui?.toast?.('Enter a valid top-up amount.');
                    input?.focus();
                    return;
                }

                button.disabled = true;
                button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending request...';

                try {
                    const result = await this.createTopup(amount);
                    const requestId =
                        result.id ||
                        result.requestId ||
                        result.paymentRequestId;

                    if (!requestId) {
                        throw new Error('The payment service did not return a request ID.');
                    }

                    this.updateStatus(
                        container,
                        {
                            ...result,
                            id: requestId,
                            status: result.status || 'pending'
                        }
                    );

                    ASIYE.ui?.toast?.('PayShap payment request sent.');

                    await this.poll(
                        requestId,
                        container
                    );
                } catch (error) {
                    console.error('PayShap request failed:', error);

                    this.updateStatus(
                        container,
                        {
                            status: 'failed',
                            message: error?.message || 'Unable to create the payment request.'
                        }
                    );

                    ASIYE.ui?.toast?.(
                        error?.message || 'Unable to create the PayShap request.'
                    );
                } finally {
                    button.disabled = !this.apiBase();
                    button.innerHTML = '<i class="fas fa-bolt"></i> Request payment';
                }
            });
        }

        this.watchBalance(
            commuterId,
            container
        );

        const dialog = context.dialog;

        if (dialog) {
            const cleanup = () => this.stop();
            dialog.addEventListener('close', cleanup, {once: true});
            dialog.addEventListener('cancel', cleanup, {once: true});
        }
    }
};
