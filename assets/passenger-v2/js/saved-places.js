/* Account-specific destinations saved on this device. */
window.ASIYE = window.ASIYE || {};
ASIYE.savedPlaces = {
    key() {
        const uid = window.firebase?.auth?.().currentUser?.uid || ASIYE.state.userId;
        return uid ? `asiye.passenger.places.v1.${encodeURIComponent(uid)}` : null;
    },
    normalize(place) {
        if (!place || place.latitude == null || place.longitude == null || place.latitude === '' || place.longitude === '') return null;
        const latitude = Number(place.latitude), longitude = Number(place.longitude);
        const address = String(place.address || place.name || '').trim().slice(0, 500);
        if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
        return {name: String(place.name || address).trim().slice(0, 200), address, latitude, longitude, placeId: String(place.placeId || '').slice(0, 200)};
    },
    read() {
        let data = {};
        const key = this.key();
        try { if (key) data = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
        return {
            home: this.normalize(data.home), work: this.normalize(data.work),
            recent: (Array.isArray(data.recent) ? data.recent : []).map(p => this.normalize(p)).filter(Boolean).slice(0, 10)
        };
    },
    write(data, owner = this.key()) {
        if (!owner || owner !== this.key()) throw new Error('Sign in again before saving your places.');
        try { localStorage.setItem(owner, JSON.stringify(data)); }
        catch { throw new Error('Could not save this address on your device. Please try again.'); }
    },
    save(kind, place, owner = this.key()) {
        if (!['home', 'work'].includes(kind)) throw new Error('Choose Home or Work.');
        const saved = this.normalize(place);
        if (!saved) throw new Error('Select an address from the search results.');
        const data = this.read();
        data[kind] = saved;
        this.write(data, owner);
    },
    remember(place) {
        const saved = this.normalize(place);
        if (!saved || !this.key()) return;
        const data = this.read();
        data.recent = [saved, ...data.recent.filter(p => !this.same(p, saved))].slice(0, 10);
        this.write(data);
    },
    same(a, b) {
        return a.address.toLowerCase() === b.address.toLowerCase() &&
            Math.abs(a.latitude - b.latitude) < 0.0001 && Math.abs(a.longitude - b.longitude) < 0.0001;
    },
    shortcuts() {
        const data = this.read();
        const edit = ['home', 'work'].filter(kind => data[kind]).map(kind =>
            `<button type="button" class="saved-place-edit" data-edit-place="${kind}">Edit ${kind === 'home' ? 'Home' : 'Work'}</button>`).join('');
        return ASIYE.ui.placeRow('home', 'Home', data.home?.address || 'Set your home address') +
            ASIYE.ui.placeRow('work', 'Work', data.work?.address || 'Set your work address') +
            ASIYE.ui.placeRow('recent', 'Recent places', data.recent.length ? `${data.recent.length} recent destinations` : 'Your recent destinations') +
            (edit ? `<div class="saved-place-actions">${edit}</div>` : '');
    },
    bindShortcuts(container) {
        container.querySelectorAll('[data-place-shortcut]').forEach(button => button.addEventListener('click', () => {
            const kind = button.dataset.placeShortcut;
            if (kind === 'recent') return this.renderRecent();
            const place = this.read()[kind];
            if (place) return ASIYE.places.resolvePlaceDetails(place);
            this.renderEditor(kind);
        }));
        container.querySelectorAll('[data-edit-place]').forEach(button => button.addEventListener('click', () => this.renderEditor(button.dataset.editPlace)));
    },
    renderEditor(kind) {
        if (!['home', 'work'].includes(kind)) return;
        const container = document.getElementById('sheetContent');
        if (!container) return;
        const owner = this.key(), saved = this.read()[kind], label = kind === 'home' ? 'Home' : 'Work';
        ASIYE.places.setSelectionHandler(place => {
            try {
                this.save(kind, place, owner);
                ASIYE.ui.renderDestinationSearch();
                ASIYE.ui.toast(`${label} address saved.`);
            } catch (error) { ASIYE.ui.toast(error.message); }
        });
        container.innerHTML = `<div class="sheet-page-header"><button type="button" id="savedPlaceBack" class="sheet-back-button" aria-label="Back to trip planning"><i class="fas fa-arrow-left"></i></button><h2 class="sheet-page-title">${saved ? 'Edit' : 'Set'} ${label}</h2></div>
            <p class="saved-place-help">Search and select an address to save your ${label.toLowerCase()}.</p>
            ${saved ? `<p class="saved-place-current">Current address: ${ASIYE.ui.escape(saved.address)}</p>` : ''}
            <div class="location-input-card"><div class="location-input-row"><span class="location-dot destination"></span><input id="savedPlaceSearch" class="location-input" type="text" autocomplete="off" placeholder="Search for an address" aria-label="${label} address"></div></div>
            <div id="destinationSuggestions" aria-live="polite"></div>
            ${saved ? `<button type="button" class="secondary-button" id="removeSavedPlace">Remove ${label} address</button>` : ''}`;
        document.getElementById('savedPlaceBack').onclick = () => ASIYE.ui.renderDestinationSearch();
        document.getElementById('savedPlaceSearch').addEventListener('input', event => ASIYE.places.search(event.target.value.trim()));
        document.getElementById('savedPlaceSearch').focus();
        document.getElementById('removeSavedPlace')?.addEventListener('click', () => {
            try {
                const data = this.read(); data[kind] = null; this.write(data, owner);
                ASIYE.ui.renderDestinationSearch();
                ASIYE.ui.toast(`${label} address removed.`);
            } catch (error) { ASIYE.ui.toast(error.message); }
        });
        ASIYE.state.ui.sheet = 'saved-place-editor';
    },
    renderRecent() {
        const container = document.getElementById('sheetContent');
        if (!container) return;
        ASIYE.places.setSelectionHandler(null);
        const owner = this.key(), recent = this.read().recent;
        container.innerHTML = `<div class="sheet-page-header"><button type="button" id="recentPlacesBack" class="sheet-back-button" aria-label="Back to trip planning"><i class="fas fa-arrow-left"></i></button><h2 class="sheet-page-title">Recent places</h2></div>
            ${recent.length ? recent.map((place, index) => `<div class="recent-place-row"><button type="button" class="place-row" data-recent-place="${index}"><div class="place-icon"><i class="fas fa-clock-rotate-left"></i></div><div class="place-info"><span class="place-name">${ASIYE.ui.escape(place.name)}</span><span class="place-address">${ASIYE.ui.escape(place.address)}</span></div></button><button type="button" class="recent-place-remove" data-remove-recent="${index}" aria-label="Remove ${ASIYE.ui.escape(place.name)} from recent places"><i class="fas fa-xmark"></i></button></div>`).join('') : '<p class="saved-place-help">Your recent destinations will appear here after you choose a place for a trip.</p>'}`;
        document.getElementById('recentPlacesBack').onclick = () => ASIYE.ui.renderDestinationSearch();
        container.querySelectorAll('[data-recent-place]').forEach(button => button.addEventListener('click', () => {
            if (owner !== this.key()) return ASIYE.ui.renderDestinationSearch();
            ASIYE.places.resolvePlaceDetails(recent[Number(button.dataset.recentPlace)]);
        }));
        container.querySelectorAll('[data-remove-recent]').forEach(button => button.addEventListener('click', () => {
            try {
                const data = this.read(), place = recent[Number(button.dataset.removeRecent)];
                data.recent = data.recent.filter(p => !this.same(p, place));
                this.write(data, owner); this.renderRecent();
            } catch (error) { ASIYE.ui.toast(error.message); }
        }));
        ASIYE.state.ui.sheet = 'recent-places';
    }
};
