/* Asiye Admin Release 11.0.57: vehicle media reviews and support inbox.
   Writes are performed only by adminManagePlatform Cloud Functions. */
(() => {
  const callable = name => firebase.functions().httpsCallable(name);
  const fetchData = resource => callable('adminFetchData')({ resource, limit: 500 }).then(r => r.data.data || {});
  const manage = payload => callable('adminManagePlatform')(payload).then(r => r.data);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = url => {
    try {
      const value = new URL(String(url || ''));
      return value.protocol === 'https:' &&
        (value.hostname === 'firebasestorage.googleapis.com' ||
          value.hostname === 'app.asiye.cloud' ||
          value.hostname === 'asiye.cloud' ||
          value.hostname === 'storage.googleapis.com')
        ? value.href : '';
    } catch (_) { return ''; }
  };
  const at = value => Number(value) ? new Date(Number(value)).toLocaleString() : '—';
  const e = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const main = () => document.getElementById('applicationsList');
  const title = (value, detail) => {
    document.getElementById('pageTitle').textContent = value;
    document.getElementById('pageSub').textContent = detail;
    document.getElementById('statsGrid').hidden = true;
  };
  const notice = message => {
    if (typeof showToast === 'function') showToast(message);
  };
  let activeView = '';
  let supportListener = null;
  let currentTicket = '';
  let reviews = {};

  async function assertAdmin() {
    const user = firebase.auth().currentUser;
    if (!user) throw Error('Sign in to the Asiye admin account.');
    const result = await callable('adminWhoAmI')({});
    if (!result.data?.uid) throw Error('Administrator approval is required.');
  }

  function stopSupport() {
    supportListener?.();
    supportListener = null;
  }
  function setView(value) {
    stopSupport();
    activeView = value;
    currentView = value; // legacy admin auto-refresh must not replace the inbox.
    document.querySelectorAll('.sidebar .menu-item').forEach(item =>
      item.classList.toggle('active', item.dataset.releaseView === value));
    main().replaceChildren(e('p', 'member-note', 'Loading…'));
  }
  function fail(error) {
    main().replaceChildren(e('p', 'member-note',
      error?.message || 'Unable to load admin data.'));
  }

  const makeField = (name, value) => {
    const label = e('label', 'release-field');
    label.append(e('span', '', name));
    const input = e('input');
    input.name = name;
    input.value = value == null ? '' : String(value);
    if (name === 'year' || name === 'seats') input.type = 'number';
    input.maxLength = 100;
    label.append(input);
    return label;
  };
  const button = (text, action, className = 'btn btn-view') => {
    const node = e('button', className, text);
    node.type = 'button';
    node.onclick = action;
    return node;
  };

  async function showVehicles() {
    setView('vehicle');
    title('Vehicle photo & edit approvals', 'Review every driver photo, proposed vehicle edit and approval status.');
    try {
      await assertAdmin();
      reviews = await fetchData('taxis');
      if (activeView !== 'vehicle') return;
      renderVehicles();
    } catch (error) { if (activeView === 'vehicle') fail(error); }
  }

  function renderVehicles() {
    const container = main();
    container.replaceChildren();
    const toolbar = e('div', 'app-card');
    toolbar.append(e('strong', '', 'Driver vehicles · v11.0.57'));
    toolbar.append(button('Refresh reviews', showVehicles));
    const filter = e('select');
    filter.setAttribute('aria-label', 'Vehicle filter');
    [['pending','Pending review'],['all','All drivers'],['approved','Approved'],['rejected','Rejected or changes requested']].forEach(([key,label]) => {
      const option = e('option', '', label);
      option.value = key;
      filter.append(option);
    });
    toolbar.append(filter);
    container.append(toolbar);
    const list = e('div');
    container.append(list);
    const entries = Object.entries(reviews).map(([id, driver]) => ({ id, ...(driver || {}) }));
    const render = () => {
      list.replaceChildren();
      const state = filter.value;
      const filtered = entries.filter(driver => {
        if (state === 'all') return true;
        if (state === 'pending') return driver.vehicleApprovalStatus === 'pending';
        if (state === 'approved') return driver.vehicleApproved === true;
        return ['rejected','changes_requested'].includes(driver.vehicleApprovalStatus);
      }).sort((a,b) => Number(b.vehicleSubmittedAt || 0) - Number(a.vehicleSubmittedAt || 0));
      if (!filtered.length) list.append(e('p', 'empty-state', 'No vehicles in this filter.'));
      for (const driver of filtered) {
        const pending = driver.vehiclePending || {};
        const approved = driver.vehicle || {};
        const vehicle = {
          type: pending.type || approved.type || driver.vehicleType || '',
          make: pending.make || approved.make || driver.vehicleMake || '',
          model: pending.model || approved.model || driver.vehicleModel || '',
          colour: pending.colour || approved.colour || driver.vehicleColor || '',
          registration: pending.registration || approved.registration || driver.vehicleReg || '',
          year: pending.year || approved.year || driver.vehicleYear || '',
          seats: pending.seats || approved.seats || driver.vehicleSeats || ''
        };
        const card = e('article', 'app-card');
        card.append(e('h3', 'app-name', driver.name || driver.fullName || driver.id));
        card.append(e('p', 'app-email', 'Driver ID: ' + driver.id +
          ' · Review: ' + (driver.vehicleApprovalStatus || 'not submitted')));
        const imageUrl = safeImage(driver.vehiclePhoto || driver.documents?.CAR_FRONT);
        if (imageUrl) {
          const image = e('img', 'release-vehicle-photo');
          image.src = imageUrl; image.alt = 'Vehicle photograph for ' + (driver.name || driver.id);
          image.loading = 'lazy';
          card.append(image);
          const link = e('a', 'doc-link', 'Open full car photo');
          link.href = imageUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
          card.append(link);
        } else {
          card.append(e('p', 'member-note', 'No saved vehicle photo. Approval cannot proceed.'));
        }
        const form = e('div', 'release-vehicle-grid');
        Object.entries(vehicle).forEach(([field,value]) => form.append(makeField(field,value)));
        card.append(form);
        const note = e('textarea');
        note.placeholder = 'Reason for rejection or changes requested';
        note.maxLength = 500;
        note.setAttribute('aria-label', 'Review reason');
        card.append(note);
        const status = e('p', 'member-note', driver.vehicleReviewReason || '');
        card.append(status);
        const actions = e('div', 'app-actions');
        const current = driver.vehicleApprovalStatus === 'pending';
        async function review(decision) {
          const fields = Object.fromEntries([...form.querySelectorAll('input')].map(input =>
            [input.name, input.name === 'year' || input.name === 'seats' ? Number(input.value) : input.value.trim()]));
          if (decision === 'approved' && !imageUrl) {
            status.textContent = 'A vehicle photo must be saved before approval.';
            return;
          }
          if (decision !== 'approved' && note.value.trim().length < 5) {
            status.textContent = 'Please provide a reason of at least five characters.';
            return;
          }
          if (!confirm('Confirm vehicle review: ' + decision + '?')) return;
          [...actions.querySelectorAll('button')].forEach(item => { item.disabled = true; });
          status.textContent = 'Saving admin decision…';
          try {
            await manage({ action: 'reviewVehicle', id: driver.id, decision,
              reason: note.value.trim(), vehicle: fields });
            notice('Vehicle ' + decision.replace('_', ' ') + '.');
            await showVehicles();
          } catch (error) {
            status.textContent = error?.message || 'Vehicle review failed.';
            [...actions.querySelectorAll('button')].forEach(item => { item.disabled = false; });
          }
        }
        if (current) {
          actions.append(button('Approve photo & edits', () => review('approved'), 'btn btn-approve'));
          actions.append(button('Request changes', () => review('changes_requested'), 'btn btn-warning'));
          actions.append(button('Reject', () => review('rejected'), 'btn btn-reject'));
        } else {
          actions.append(e('span', 'app-email', 'Driver must submit updates before a new decision.'));
        }
        card.append(actions);
        list.append(card);
      }
    };
    filter.onchange = render;
    render();
  }

  async function showSupport() {
    setView('support');
    title('Asiye Support Inbox', 'Live conversations with drivers and passengers.');
    try {
      await assertAdmin();
      if (activeView !== 'support') return;
      const ref = firebase.database().ref('support_chats');
      const onValue = snapshot => {
        if (activeView !== 'support') return;
        renderSupport(snapshot.val() || {});
      };
      ref.on('value', onValue, error => fail(error));
      supportListener = () => ref.off('value', onValue);
    } catch (error) { if (activeView === 'support') fail(error); }
  }

  function renderSupport(data) {
    const container = main();
    container.replaceChildren();
    const list = e('div', 'release-support-list');
    const thread = e('div', 'app-card release-support-detail');
    const layout = e('div', 'release-support-layout');
    layout.append(list, thread);
    container.append(layout);
    const tickets = Object.entries(data)
      .map(([id, item]) => ({ id, ...(item || {}) }))
      .sort((a,b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    if (!tickets.length) {
      list.append(e('p', 'empty-state', 'No support conversations yet.'));
      thread.append(e('p', '', 'Driver and passenger messages will appear here.'));
      return;
    }
    if (!tickets.some(ticket => ticket.id === currentTicket)) currentTicket = tickets[0].id;
    for (const ticket of tickets) {
      const btn = button((ticket.name || ticket.role || 'User') + ' · ' +
        (ticket.subject || 'Support') + ' · ' + (ticket.status || 'open'), () => {
          currentTicket = ticket.id;
          renderSupport(data);
        }, 'btn btn-view release-ticket-button');
      if (ticket.id === currentTicket) btn.classList.add('active');
      list.append(btn);
    }
    const ticket = tickets.find(item => item.id === currentTicket);
    thread.append(e('h3', '', (ticket.name || ticket.role || 'User') + ' · ' + (ticket.role || '')));
    thread.append(e('p', 'app-email', 'Ticket ' + ticket.id + ' · ' + (ticket.phone || ticket.email || '')));
    const history = e('div', 'release-support-history');
    const message = e('div', 'member-info');
    message.append(e('strong', '', 'User · ' + (ticket.subject || 'Support')));
    message.append(e('p', '', ticket.message || ''));
    history.append(message);
    Object.values(ticket.messages || {})
      .sort((a,b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .forEach(item => {
        const node = e('div', 'member-info');
        node.append(e('strong', '', (item.senderRole === 'admin' ? 'Asiye Admin' : ticket.role || 'User') + ' · ' + at(item.createdAt)));
        node.append(e('p', '', item.text || ''));
        history.append(node);
      });
    thread.append(history);
    const reply = e('textarea');
    reply.setAttribute('maxlength', '1500');
    reply.setAttribute('rows', '4');
    reply.placeholder = 'Reply to this passenger or driver';
    thread.append(reply);
    const status = e('p', 'app-email', 'Status: ' + (ticket.status || 'open'));
    thread.append(status);
    const controls = e('div', 'app-actions');
    controls.append(button('Send reply', async () => {
      if (reply.value.trim().length < 2) return;
      try {
        await manage({ action: 'replySupport', id: ticket.id, message: reply.value.trim() });
        reply.value = '';
        status.textContent = 'Reply sent.';
      } catch (error) { status.textContent = error?.message || 'Could not reply.'; }
    }, 'btn btn-approve'));
    controls.append(button('Resolve ticket', async () => {
      try {
        await manage({ action: 'updateSupport', id: ticket.id, status: 'resolved', note: '' });
        status.textContent = 'Ticket resolved.';
      } catch (error) { status.textContent = error?.message || 'Could not resolve.'; }
    }, 'btn btn-view'));
    thread.append(controls);
  }


  // New-driver enrollment review: the complete identity, vehicle and
  // residency evidence is visible before an account can be activated.
  async function showEnrollments() {
    setView('enrollments');
    title('Driver enrollment approvals', 'Review submitted OTP-verified applications and supporting images and documents.');
    try {
      await assertAdmin();
      const records = await fetchData('driverEnrollments');
      if (activeView !== 'enrollments') return;
      renderEnrollments(records);
    } catch (error) {
      if (activeView === 'enrollments') fail(error);
    }
  }

  function renderEnrollments(records) {
    const holder = main();
    holder.replaceChildren();
    const top = e('div', 'app-card');
    top.append(e('strong', '', 'New driver registrations · Pending admin verification'));
    top.append(button('Refresh applications', showEnrollments));
    holder.append(top);
    const list = Object.entries(records || {})
      .map(([uid, value]) => ({ uid, ...(value || {}) }))
      .filter(item => item.status === 'pending' || item.status === 'pending_review')
      .sort((a,b) => Number(b.submittedAt || 0) - Number(a.submittedAt || 0));
    if (!list.length) {
      holder.append(e('p', 'empty-state', 'No new applications awaiting approval.'));
      return;
    }
    list.forEach(app => {
      const card = e('article', 'app-card');
      const vehicle = app.vehiclePending || {};
      card.append(e('h3', '', app.fullName || 'New driver'));
      card.append(e('p', 'app-email', (app.phone || 'Unverified phone') +
        ' · Submitted ' + at(app.submittedAt) +
        ' · ' + (app.phoneVerified ? 'OTP verified' : 'Phone verification missing')));
      card.append(e('p', 'app-details', 'Residential address: ' + (app.residentialAddress || 'Not supplied')));
      const docs = app.documentUrls || {};
      const attachments = [
        ['Live face scan', docs.selfie || app.profileImageUrl, true],
        ['Car photo', docs.car || app.vehiclePhoto, true],
        ['Identity document', docs.identity, true],
        ['Driver licence', docs.licence, false],
        ['Proof of address', docs.address, false]
      ];
      const media = e('div', 'release-enrollment-media');
      let allDocs = true;
      attachments.forEach(([label,url,withPreview]) => {
        const link = safeImage(url);
        if (!link) allDocs = false;
        const item = e('div', 'doc-item');
        item.append(e('strong', 'doc-label', label));
        if (link) {
          if (withPreview && !/\.(pdf)(\?|$)/i.test(link)) {
            const image = e('img', 'release-document-image');
            image.src = link;
            image.alt = label + ' submitted for verification';
            image.loading = 'lazy';
            item.append(image);
          }
          const action = e('a', 'doc-link', 'View full document');
          action.href = link;
          action.target = '_blank';
          action.rel = 'noopener noreferrer';
          item.append(action);
        } else item.append(e('p', 'member-note', 'Document missing'));
        media.append(item);
      });
      card.append(media);
      const editPanel = e('div', 'release-vehicle-grid');
      const values = {
        type: vehicle.type || 'sedan',
        make: vehicle.make || app.vehicleMake || '',
        model: vehicle.model || app.vehicleModel || '',
        colour: vehicle.colour || app.vehicleColor || '',
        registration: vehicle.registration || app.vehicleReg || '',
        year: vehicle.year || app.vehicleYear || '',
        seats: vehicle.seats || 4
      };
      Object.entries(values).forEach(([key,value])=>editPanel.append(makeField(key,value)));
      card.append(e('h4', '', 'Review and correct vehicle details'));
      card.append(editPanel);
      const reason = e('textarea');
      reason.placeholder = 'Explain what is missing or why the application is rejected';
      reason.maxLength = 600;
      reason.setAttribute('aria-label', 'Rejection reason');
      card.append(reason);
      const status = e('p', 'member-note', '');
      card.append(status);
      const actions = e('div', 'app-actions');
      async function decide(decision) {
        if (decision === 'approved' && (!allDocs || !app.phoneVerified)) {
          status.textContent = 'All five images/documents and OTP verification are required.';
          return;
        }
        if (decision === 'rejected' && reason.value.trim().length < 5) {
          status.textContent = 'Please explain what the driver needs to correct.';
          return;
        }
        if (!confirm('Confirm ' + decision + ' for ' + (app.fullName || app.uid) + '?')) return;
        [...actions.querySelectorAll('button')].forEach(btn => { btn.disabled = true; });
        status.textContent = 'Recording administrator decision…';
        try {
          const corrected = Object.fromEntries([...editPanel.querySelectorAll('input')]
            .map(input => [input.name, ['year','seats'].includes(input.name)
              ? Number(input.value) : input.value.trim()]));
          const result = await callable('reviewDriverEnrollment')({
            uid: app.uid, decision, reason: reason.value.trim(), vehicle: corrected
          });
          if (!result.data?.ok) throw Error('Review could not be saved.');
          notice('Driver application ' + decision + '.');
          await showEnrollments();
        } catch (error) {
          status.textContent = error?.message || 'Could not review driver.';
          [...actions.querySelectorAll('button')].forEach(btn => { btn.disabled = false; });
        }
      }
      actions.append(button('Approve & activate', () => decide('approved'), 'btn btn-approve'));
      actions.append(button('Reject with reason', () => decide('rejected'), 'btn btn-reject'));
      card.append(actions);
      holder.append(card);
    });
  }

  async function showCardPayouts() {
    setView('cardPayouts');
    title('Driver Card Payouts · 80/20', 'Reconcile paid, pending and bank-unverified driver transfers.');
    try {
      await assertAdmin();
      const records = await fetchData('driverCardPayouts');
      if (activeView !== 'cardPayouts') return;
      const view = main();
      view.replaceChildren();
      const all = [];
      Object.entries(records || {}).forEach(([tripId, passengers]) =>
        Object.entries(passengers || {}).forEach(([passengerId, value]) =>
          all.push({ tripId, passengerId, ...value })));
      const toolbar = e('div', 'app-card');
      toolbar.append(e('strong', '', all.length + ' card payout entries'));
      toolbar.append(button('Refresh payouts', showCardPayouts));
      view.append(toolbar);
      const filters = e('select');
      filters.setAttribute('aria-label', 'Payout filter');
      [['all','All'],['paid','Paid'],['transfer_pending','Transfer pending'],
       ['awaiting_bank','Awaiting bank'],['needs_reconciliation','Needs reconciliation'],
       ['otp_required','OTP required'],['transfer_failed','Transfer failed']].forEach(([v,t])=>{
         const option=e('option','',t);option.value=v;filters.append(option);
       });
      view.append(filters);
      const list=e('div');view.append(list);
      const render=()=>{
        list.replaceChildren();
        const relevant=all.filter(entry=>filters.value==='all'||entry.status===filters.value)
          .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
        if (!relevant.length)list.append(e('p','member-note','No payouts match this filter.'));
        relevant.forEach(item=>{
          const card=e('article','app-card');
          card.append(e('h3','', 'Driver ' + (item.driverId||'Unknown')));
          card.append(e('p','app-email','Trip '+item.tripId+' · Passenger '+item.passengerId));
          card.append(e('p','', 'Gross: R'+(Number(item.grossSubunit||0)/100).toFixed(2)+
             ' · Driver 80%: R'+(Number(item.driverSubunit||0)/100).toFixed(2)+
             ' · Asiye 20%: R'+(Number(item.asiyeSubunit||0)/100).toFixed(2)));
          card.append(e('strong','', 'Status: '+(item.status||'unknown')));
          if (['needs_reconciliation','otp_required','transfer_failed','reversed'].includes(item.status)) {
            card.append(e('p','member-note',
              'Action required in Paystack Dashboard. Verify the existing transfer reference before retrying; never send a duplicate.'));
          }
          card.append(e('p','app-email','Created: '+at(item.createdAt)));
          list.append(card);
        });
      };
      filters.onchange=render;render();
    } catch(error) {
      if (activeView === 'cardPayouts')fail(error);
    }
  }

  window.AsiyeAdminRelease = { showVehicles, showSupport, showEnrollments, showCardPayouts, safeImage };
})();
