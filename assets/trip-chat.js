/* Shared passenger/driver chat. Access is enforced by Firebase database rules. */
window.AsiyeTripChat = {
    unread: new Map(),
    watches: new Map(),
    close() {
        if (this.query && this.listener) this.query.off('value', this.listener);
        this.query = null;
        this.listener = null;
        this.dialog?.remove();
        this.dialog = null;
        this.previousFocus?.focus();
    },
    open(request, requestId, passengerId) {
        this.close();
        const driver = !!window.ASIYE_DRIVER;
        const app = driver ? ASIYE_DRIVER : ASIYE;
        if (!requestId || !request || !firebase.auth().currentUser) {
            app.ui.toast('Please sign in and open an active trip to chat.');
            return;
        }
        if (!driver) passengerId = app.state.userId;
        const members = request.type === 'club' ? Object.entries(request.passengers || {}) : [[request.commuterId, { name: request.commuterName }]];
        passengerId ||= members[0]?.[0];
        if (!passengerId || !members.some(([id]) => id === passengerId)) {
            app.ui.toast('Passenger information is unavailable.');
            return;
        }
        const dialog = document.createElement('dialog');
        this.previousFocus = document.activeElement;
        dialog.className = 'trip-chat';
        dialog.setAttribute('aria-label', 'Trip messages');
        dialog.innerHTML = `<header><div><small>TRIP MESSAGES</small><h2></h2></div><button type="button" aria-label="Close chat">×</button></header>
            <select aria-label="Choose passenger" hidden></select>
            <div class="trip-chat-messages" role="log" aria-live="polite"></div>
            <p class="trip-chat-status" role="status">Loading messages…</p>
            <form><label class="trip-chat-label" for="tripChatText">Message</label><textarea id="tripChatText" placeholder="Write a message…" maxlength="1000" rows="2" required></textarea><button type="submit">Send</button></form>`;
        document.body.append(dialog);
        this.dialog = dialog;
        dialog.querySelector('h2').textContent = driver ? 'Chat with passenger' : (request.driverName || 'Your driver');
        const selector = dialog.querySelector('select');
        if (driver && members.length > 1) {
            selector.hidden = false;
            members.forEach(([id, member]) => {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = member.name || member.commuterName || 'Passenger';
                selector.append(option);
            });
            selector.value = passengerId;
            selector.onchange = () => this.open(request, requestId, selector.value);
        }
        dialog.querySelector('header button').onclick = () => this.close();
        dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        const messages = dialog.querySelector('.trip-chat-messages');
        const status = dialog.querySelector('.trip-chat-status');
        const roomKey = `${requestId}/${passengerId}`;
        const ref = firebase.database().ref(`tripChats/${roomKey}`);
        const query = ref.orderByChild('createdAt').limitToLast(100);
        this.unread.set(roomKey, 0);
        this.updateBadge();
        this.query = query;
        this.listener = query.on('value', snapshot => {
            if (this.dialog !== dialog) return;
            const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
            const first = !messages.children.length;
            messages.replaceChildren();
            snapshot.forEach(child => {
                const message = child.val();
                if (typeof message.text !== 'string') return;
                const bubble = document.createElement('div');
                bubble.className = 'trip-chat-bubble' + (message.senderUid === firebase.auth().currentUser?.uid ? ' mine' : '');
                const text = document.createElement('p');
                text.textContent = message.text;
                const time = document.createElement('small');
                time.textContent = typeof message.createdAt === 'number' ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sending…';
                bubble.append(text, time);
                messages.append(bubble);
            });
            status.textContent = messages.children.length ? '' : 'Say hello or share your pickup details.';
            if (first || nearBottom) messages.scrollTop = messages.scrollHeight;
        }, () => { if (this.dialog === dialog) status.textContent = 'Chat could not load. Check your connection and chat access.'; });
        dialog.querySelector('form').onsubmit = async event => {
            event.preventDefault();
            const input = dialog.querySelector('textarea');
            const text = input.value.trim();
            const user = firebase.auth().currentUser;
            if (!text || text.length > 1000 || !user) return;
            const button = dialog.querySelector('[type="submit"]');
            button.disabled = true;
            status.textContent = 'Sending…';
            try {
                await ref.push({ text, senderUid: user.uid, role: driver ? 'driver' : 'passenger', createdAt: firebase.database.ServerValue.TIMESTAMP });
                if (input.value.trim() === text) input.value = '';
                status.textContent = '';
            } catch {
                status.textContent = 'Message not sent. Your text is saved here; please try again.';
            } finally { button.disabled = false; }
        };
        dialog.showModal();
    },
    updateBadge() {
        const total = [...this.unread.values()].reduce((sum, value) => sum + value, 0);
        document.querySelectorAll('[data-trip-chat-badge]').forEach(node => {
            node.textContent = total > 99 ? '99+' : String(total);
            node.hidden = total === 0;
        });
    },
    watch(request, requestId, passengerId) {
        if (!requestId || !request || !firebase.auth().currentUser) return;
        const driver = !!window.ASIYE_DRIVER;
        const app = driver ? ASIYE_DRIVER : ASIYE;
        if (!driver) passengerId = app.state.userId;
        const members = request.type === 'club'
            ? Object.keys(request.passengers || {})
            : [request.commuterId];
        passengerId ||= members[0];
        if (!passengerId || !members.includes(passengerId)) return;
        const roomKey = `${requestId}/${passengerId}`;
        if (this.watches.has(roomKey)) return;
        const ref = firebase.database().ref(`tripChats/${roomKey}`).orderByChild('createdAt').limitToLast(1);
        let ready = false;
        const listener = ref.on('value', snapshot => {
            if (!ready) { ready = true; return; }
            if (this.dialog) return;
            let latest = null;
            snapshot.forEach(child => { latest = child.val(); });
            if (!latest || latest.senderUid === firebase.auth().currentUser?.uid) return;
            this.unread.set(roomKey, (this.unread.get(roomKey) || 0) + 1);
            this.updateBadge();
            app.ui.toast(driver ? 'New message from passenger' : 'New message from your driver');
        });
        this.watches.set(roomKey, { ref, listener });
    },
    watchTrip(request, requestId) {
        if (!request || !requestId) return;
        const driver = !!window.ASIYE_DRIVER;
        if (driver && request.type === 'club') {
            Object.keys(request.passengers || {}).forEach(id => this.watch(request, requestId, id));
        } else {
            this.watch(request, requestId);
        }
    },
    stopWatchingTrip(requestId) {
        const prefix = `${requestId}/`;
        for (const [key, watch] of this.watches.entries()) {
            if (!key.startsWith(prefix)) continue;
            watch.ref.off('value', watch.listener);
            this.watches.delete(key);
            this.unread.delete(key);
        }
        this.updateBadge();
    }
};
document.addEventListener('DOMContentLoaded', () => {
    if (!window.ASIYE_DRIVER) return;
    const button = document.createElement('button');
    button.className = 'driver-chat-launch';
    button.innerHTML = 'Message passenger <span data-trip-chat-badge hidden>0</span>';
    button.onclick = () => AsiyeTripChat.open(ASIYE_DRIVER.trip.request, ASIYE_DRIVER.trip.requestId, ASIYE_DRIVER.trip.currentPassengerId);
    document.body.append(button);
});
