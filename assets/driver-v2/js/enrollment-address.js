/* Mapbox Geocoding v6, South Africa only. Coordinates are not retained. */
(() => {
  const input = document.getElementById('residentialAddress');
  const matches = document.getElementById('addressSuggestions');
  const message = document.getElementById('addressLookupStatus');
  if (!input || !matches) return;
  const token = window.ASIYE_DRIVER_CONFIG?.mapboxToken;
  let timer, current = null, generation = 0;
  const clear = () => { matches.replaceChildren(); matches.hidden = true; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const myGeneration = ++generation;
    clear();
    if (q.length < 4) return;
    if (!token || !token.startsWith('pk.')) {
      message.textContent = 'Address lookup unavailable. Please type your full address manually.';
      return;
    }
    timer = setTimeout(async () => {
      current?.abort();
      current = new AbortController();
      try {
        const params = new URLSearchParams({
          q: q.slice(0,200), access_token: token, country: 'za',
          language: 'en', types: 'address,street,place,locality,neighborhood',
          autocomplete:'true', limit: '6'
        });
        const response = await fetch('https://api.mapbox.com/search/geocode/v6/forward?' + params,
          { signal: current.signal });
        if (!response.ok) throw Error('Address lookup temporarily unavailable.');
        const data = await response.json();
        if (generation !== myGeneration) return;
        clear();
        for (const feature of (data.features || [])) {
          const label = String(feature.properties?.full_address || feature.properties?.name_preferred || '').trim();
          if (!label) continue;
          const button = document.createElement('button');
          button.type='button'; button.setAttribute('role','option');
          button.textContent = label;
          button.onclick = () => {
            input.value = label;
            input.dispatchEvent(new Event('change', { bubbles:true }));
            message.textContent = 'Address selected. Confirm it matches your proof of address.';
            clear();
          };
          matches.append(button);
        }
        matches.hidden = !matches.children.length;
        message.textContent = matches.children.length
          ? 'Select the correct address from the list.'
          : 'No exact address found. Enter your address manually.';
      } catch(error) {
        if (error.name === 'AbortError') return;
        message.textContent = 'Address suggestions unavailable. You may enter your address manually.';
      }
    }, 350);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') clear();
  });
  document.addEventListener('click', event => {
    if (event.target !== input && !matches.contains(event.target)) clear();
  });
})();