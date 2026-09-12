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
            body.innerHTML = `<div class="member-avatar">${esc((user.name || user.firstName || 'A').charAt(0))}</div><h2>${esc(user.name || user.firstName || 'Your account')}</h2>` + this.row('Phone', user.phone || user.phoneNumber) + this.row('Email', user.email) + this.row('Account type', driver ? 'Driver' : 'Passenger');
        } else if (page === 'wallet') {
            body.innerHTML = `<div class="member-balance"><small>Available wallet balance</small><strong>${this.money(user.credits ?? user.walletBalance)}</strong></div>` + note('Wallet credits shown from your account. Choose your payment method when booking a ride.') + this.row('Currency', 'South African rand · ZAR');
        } else if (page === 'vehicle') {
            body.innerHTML = `<div class="member-balance"><small>Registered vehicle</small><strong>${esc(user.vehicleReg || user.registration || 'Not provided')}</strong></div>` + this.row('Make', user.vehicleMake || user.make) + this.row('Model', user.vehicleModel || user.model) + this.row('Colour', user.vehicleColor || user.color) + this.row('Seats', user.capacity || user.seats) + note('Contact support to correct registered vehicle details.');
        } else if (page === 'safety') {
            body.innerHTML = `<h2>Every ride, with care</h2><div class="member-info"><h3>Before your ride</h3><p>${driver ? 'Confirm your passenger and their pickup PIN before starting the ride.' : 'Match the vehicle plate and driver details. Share your pickup PIN only when ready to start.'}</p></div><div class="member-info"><h3>During your ride</h3><p>Wear a seat belt. Keep communication in the trip chat. Stop in a safe place if you need assistance.</p></div><button class="member-primary" data-support>Contact support</button>`;
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
