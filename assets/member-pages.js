/* Shared account pages. Opening a page does not replace the active trip UI. */
window.AsiyePages = {
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
    money(value) { return Number.isFinite(Number(value)) && value != null ? `R${Number(value).toFixed(2)}` : 'Not available'; },
    row(label, value) { return `<div class="member-row"><span>${this.escape(label)}</span><strong>${this.escape(value ?? 'Not provided')}</strong></div>`; },
    async open(page) {
        this.dialog?.close(); this.dialog?.remove();
        const driver = !!window.ASIYE_DRIVER;
        const app = driver ? ASIYE_DRIVER : ASIYE;
        const user = (driver ? app.state.driver : app.state.user) || {};
        const id = driver ? app.state.driverId : app.state.userId;
        const titles = { trips: driver ? 'Trip history' : 'My trips', wallet:'Wallet', parcels:'Parcels', safety:'Safety', support:'Support', account:'Account', earnings:'Earnings', club:'Club rides', vehicle:'Vehicle' };
        if (!titles[page]) return;
        const dialog = document.createElement('dialog');
        this.dialog = dialog;
        dialog.className = 'member-page';
        dialog.setAttribute('aria-label', titles[page]);
        dialog.innerHTML = `<header><div><small>ASIYE · ${driver ? 'DRIVER' : 'PASSENGER'}</small><h1>${titles[page]}</h1></div><button aria-label="Close page">×</button></header><main><p class="member-note">Loading…</p></main>`;
        document.body.append(dialog);
        dialog.querySelector('header button').onclick = () => { dialog.close(); dialog.remove(); };
        dialog.addEventListener('cancel', () => dialog.remove());
        dialog.showModal();
        const body = dialog.querySelector('main');
        const esc = value => this.escape(value);
        const note = text => `<p class="member-note">${esc(text)}</p>`;
        if (page === 'account') {
            const initial = esc((user.name || user.firstName || 'A').charAt(0));
            const photoUrl = !driver && window.ASIYE?.profile
                ? ASIYE.profile.getUrl(user)
                : (user.profile_picture_url || user.profileImageUrl || '');
            const avatar = photoUrl
                ? `<div class="member-avatar member-avatar-photo"><img data-passenger-profile-preview src="${esc(photoUrl)}" alt="Profile picture"></div>`
                : `<div class="member-avatar">${initial}</div>`;

            body.innerHTML =
                avatar +
                `<h2>${esc(user.name || user.firstName || 'Your account')}</h2>` +
                this.row('Phone', user.phone || user.phoneNumber) +
                this.row('Email', user.email) +
                this.row('Account type', driver ? 'Driver' : 'Passenger');

            if (!driver) {
                body.innerHTML += `
                    <div class="member-profile-photo-actions">
                        <button type="button" class="member-primary" data-passenger-profile-camera>
                            ${photoUrl ? 'Change profile picture' : 'Take profile picture'}
                        </button>
                        <input
                            type="file"
                            accept="image/*"
                            capture="user"
                            data-passenger-profile-file
                            hidden
                        >
                        <p class="member-note" data-passenger-profile-status>
                            Use the camera to capture a clear face photo. The image is compressed and saved through Asiye's PHP image server.
                        </p>
                    </div>
                `;

                if (
                    window.ASIYE?.profile &&
                    typeof ASIYE.profile.bindAccount === 'function'
                ) {
                    ASIYE.profile.bindAccount(body);
                }
            }
        } else if (page === 'wallet') {
            const returnStatus = new URLSearchParams(location.search).get('wallet');
            body.innerHTML =
                `<div class="member-balance"><small>Available wallet balance</small><strong>${this.money(user.credits ?? user.walletBalance)}</strong></div>` +
                (returnStatus === 'success'
                    ? note('Payment returned successfully. Your balance will update after PayFast confirms it.')
                    : returnStatus === 'cancelled'
                        ? note('The payment was cancelled and no funds were added.')
                        : note('Add funds securely using PayFast Sandbox.')) +
                `<form class="wallet-topup" data-wallet-topup>
                    <label>Amount to add</label>
                    <div class="wallet-amounts">
                        <button type="button" data-amount="50">R50</button>
                        <button type="button" data-amount="100">R100</button>
                        <button type="button" data-amount="200">R200</button>
                        <button type="button" data-amount="500">R500</button>
                    </div>
                    <div class="wallet-custom">
                        <span>R</span>
                        <input name="amount" type="number" inputmode="decimal" min="10" max="5000" step="0.01" placeholder="Enter amount" required>
                    </div>
                    <button class="member-primary" type="submit">Add funds with PayFast</button>
                    <p class="member-note">Sandbox payments use test money. Funds are credited only after secure PayFast confirmation.</p>
                </form>` +
                this.row('Currency', 'South African rand · ZAR');
            const form = body.querySelector('[data-wallet-topup]');
            const input = form.querySelector('input[name="amount"]');
            form.querySelectorAll('[data-amount]').forEach(button => {
                button.onclick = () => {
                    input.value = button.dataset.amount;
                    form.querySelectorAll('[data-amount]').forEach(item => item.classList.remove('selected'));
                    button.classList.add('selected');
                };
            });
            form.onsubmit = async event => {
                event.preventDefault();
                const submit = form.querySelector('[type="submit"]');
                submit.disabled = true;
                submit.textContent = 'Opening PayFast…';
                try {
                    await ASIYE.wallet.startTopup(Number(input.value));
                } catch (error) {
                    submit.disabled = false;
                    submit.textContent = 'Add funds with PayFast';
                    app.ui?.toast?.(error.message || 'Unable to start payment.');
                }
            };
        } else if (page === 'vehicle') {
            body.innerHTML = `<div class="member-balance"><small>Registered vehicle</small><strong>${esc(user.vehicleReg || user.registration || 'Not provided')}</strong></div>` + this.row('Make', user.vehicleMake || user.make) + this.row('Model', user.vehicleModel || user.model) + this.row('Colour', user.vehicleColor || user.color) + this.row('Seats', user.capacity || user.seats) + note('Contact support to correct registered vehicle details.');
        } else if (page === 'safety') {
            if (!id) {
                body.innerHTML = note('Sign in to manage loved ones.');
                return;
            }
            const root = driver ? 'taxis' : 'commuters';
            const familyRef = firebase.database().ref(`${root}/${id}/familyMembers`);
            const familySnapshot = await familyRef.once('value');
            const members = [];
            familySnapshot.forEach(child => members.push({ id: child.key, ...child.val() }));
            body.innerHTML = `
                <h2>Loved ones & live location</h2>
                <p class="member-note">Save trusted people, then share your active trip through your phone's secure share sheet.</p>
                <div data-family-list>${members.length ? members.map(m => `<div class="member-row"><span>${esc(m.name)}</span><strong>${esc(m.phone)}</strong></div>`).join('') : note('No loved one added yet.')}</div>
                <form data-family-form>
                    <label>Full name</label><input name="name" required maxlength="80">
                    <label>Mobile number</label><input name="phone" type="tel" required maxlength="24">
                    <button class="member-primary" type="submit">Add loved one</button>
                </form>
                <button class="member-primary" data-share-live>Share active trip location</button>
                <button class="member-primary" data-support>Contact support</button>`;
            body.querySelector('[data-family-form]').onsubmit = async event => {
                event.preventDefault();
                const form = event.currentTarget;
                await familyRef.push({
                    name: form.name.value.trim(),
                    phone: form.phone.value.trim(),
                    addedAt: firebase.database.ServerValue.TIMESTAMP
                });
                this.open('safety');
            };
            body.querySelector('[data-share-live]').onclick = async () => {
                const requestId = app.state?.activeRequest?.requestId ||
                    app.state?.booking?.requestId ||
                    localStorage.getItem('currentRequestId');
                if (!requestId) return app.ui?.toast?.('There is no active trip to share.');
                const url = `https://asiye.cloud/track.html?trip=${encodeURIComponent(requestId)}`;
                const text = `Follow my Asiye trip live: ${url}`;
                if (window.AsiyeNativeAuth?.post({ action:'share', text })) return;
                if (navigator.share) await navigator.share({ title:'My Asiye trip', text, url });
                else await navigator.clipboard.writeText(text);
            };
            body.querySelector('[data-support]').onclick = () => this.open('support');
        } else if (page === 'support') {
            const config = driver ? window.ASIYE_DRIVER_CONFIG : window.ASIYE_CONFIG;
            body.innerHTML = `<h2>How can we help?</h2><details class="member-info"><summary>My driver or passenger cannot find me</summary><p>Use Message on your trip to share a nearby landmark and agree on a safe meeting point.</p></details><details class="member-info"><summary>My payment or fare looks incorrect</summary><p>Keep your trip reference and the amount shown on the completed-trip receipt.</p></details><details class="member-info"><summary>Map or location is unavailable</summary><p>Allow location access in your browser or device settings, check your connection, then recenter the map.</p></details>`;
            const email = config?.supportEmail;
            if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.innerHTML += `<a class="member-primary" href="mailto:${encodeURIComponent(email)}">Email support</a>`;
            else body.innerHTML += note('Direct support contact has not been configured for this app yet.');
        } else {
            try {
                if (!id) throw new Error('Sign in to view your records.');
                const root = page === 'parcels' ? 'delivery_requests' : 'requests';
                const field = driver ? 'taxiId' : 'commuterId';
                const queries = [firebase.database().ref(root).orderByChild(field).equalTo(id).limitToLast(100).once('value')];
                if (!driver && root === 'requests') queries.push(firebase.database().ref(root).orderByChild(`passengers/${id}/status`).startAt('').limitToLast(100).once('value'));
                const results = await Promise.all(queries);
                if (this.dialog !== dialog) return;
                const records = new Map();
                results.forEach(snapshot => snapshot.forEach(child => records.set(child.key, { ...child.val(), key: child.key })));
                let rides = [...records.values()].sort((a,b) => Number(b.timestamp || b.createdAt || 0) - Number(a.timestamp || a.createdAt || 0));
                if (page === 'club') rides = rides.filter(ride => ride.type === 'club');
                let html = '';
                if (page === 'earnings') {
                    rides = rides.filter(ride => ride.status === 'completed');
                    const known = rides.filter(ride => ride.type !== 'club' && Number.isFinite(Number(ride.finalAmount ?? ride.calculatedPrice ?? ride.price)));
                    const sum = known.reduce((total, ride) => total + Number(ride.finalAmount ?? ride.calculatedPrice ?? ride.price), 0);
                    html += `<div class="member-balance"><small>Recorded GO fares</small><strong>${this.money(sum)}</strong></div>` + note('Gross fares from loaded completed GO rides, before fees. Club earnings and payouts are not included.');
                }
                html += note('Showing up to 100 recent records per booking type.');
                if (!rides.length) html += `<div class="member-empty"><h2>No ${page === 'parcels' ? 'parcels' : 'trips'} yet</h2><p>Your records will appear here once available.</p></div>`;
                rides.forEach(ride => {
                    const passenger = ride.passengers?.[id] || {};
                    const amount = driver ? (ride.finalAmount ?? ride.calculatedPrice ?? ride.price) : (passenger.finalAmount ?? passenger.price ?? ride.finalAmount ?? ride.calculatedPrice ?? ride.pricePerPassenger ?? ride.price);
                    const stamp = Number(ride.timestamp || ride.createdAt);
                    html += `<details class="member-trip"><summary><span><small>${esc(String(ride.status || 'Booked').replace(/_/g,' '))}</small><strong>${esc(ride.destination || ride.destinationName || ride.dropoffAddress || 'Trip')}</strong></span><b>${this.money(amount)}</b></summary><div>${this.row('Date', stamp && Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : 'Not recorded')}${this.row('Reference',ride.key)}${this.row('Service',ride.type || 'Ride')}${this.row('Payment',passenger.paymentMethod || ride.paymentMethod)}</div></details>`;
                });
                body.innerHTML = html;
            } catch (error) {
                body.innerHTML = note('Records could not load. Check your connection and account access.') + '<button class="member-primary">Retry</button>';
                body.querySelector('button').onclick = () => this.open(page);
            }
        }
    }
};
