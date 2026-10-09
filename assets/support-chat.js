/* Driver and passenger support conversations. Tickets and replies are
 * scoped by Firebase RTDB auth rules to the user's own authUid. */
(() => {
  let stopList = null;
  let stopThread = null;
  let activeRoot = null;
  let refreshList = () => {};

  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const at = timestamp => Number(timestamp)
    ? new Date(Number(timestamp)).toLocaleString() : '';
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function cleanup() {
    if (stopList) stopList();
    if (stopThread) stopThread();
    stopList = null;
    stopThread = null;
    activeRoot = null;
    refreshList = () => {};
  }

  function mount(container, { role = 'passenger', dialog } = {}) {
    cleanup();
    const user = firebase.auth().currentUser;
    const host = container.querySelector('[data-support-conversations]');
    if (!host || !user) return;
    const db = firebase.database();
    const query = db.ref('support_chats')
      .orderByChild('authUid').equalTo(user.uid).limitToLast(50);
    host.innerHTML = '<h3>My support conversations</h3><p class="member-note">Loading support messages…</p>';
    const tickets = el('div', 'asiye-support-tickets');
    const thread = el('div', 'asiye-support-thread');
    const status = el('p', 'member-note');
    const replyForm = el('form', 'member-support-reply-form');
    const replyBox = el('textarea');
    replyBox.setAttribute('maxlength', '1500');
    replyBox.setAttribute('rows', '3');
    replyBox.setAttribute('placeholder', 'Reply to Asiye Support');
    replyBox.required = true;
    const send = el('button', 'member-primary', 'Send reply');
    send.type = 'submit';
    replyForm.append(replyBox, send);
    host.replaceChildren(el('h3', '', 'My support conversations'), tickets, thread, replyForm, status);
    replyForm.hidden = true;

    const isCurrent = () => dialog?.isConnected !== false;

    function openTicket(id) {
      if (stopThread) stopThread();
      activeRoot = db.ref('support_chats/' + id);
      replyForm.hidden = false;
      thread.replaceChildren(el('p', 'member-note', 'Loading conversation…'));
      const handler = snapshot => {
        if (!isCurrent()) return;
        const ticket = snapshot.val();
        if (!ticket || ticket.authUid !== user.uid) {
          thread.replaceChildren(el('p', 'member-note', 'Conversation unavailable.'));
          return;
        }
        thread.replaceChildren();
        const first = el('div', 'member-info');
        first.append(el('strong', '', 'You · ' + (ticket.subject || 'support')));
        first.append(el('p', '', String(ticket.message || '')));
        thread.append(first);
        Object.values(ticket.messages || {})
          .sort((a,b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
          .forEach(item => {
            const node = el('div', 'member-info');
            node.append(el('strong', '', item.senderRole === 'admin' ? 'Asiye Support' : 'You'));
            node.append(el('p', '', String(item.text || '')));
            node.append(el('small', '', at(item.createdAt)));
            thread.append(node);
          });
        if (ticket.adminNote && !Object.values(ticket.messages || {}).length) {
          thread.append(el('p', 'member-note', 'Support note: ' + ticket.adminNote));
        }
        status.textContent = 'Status: ' + (ticket.status || 'open');
      };
      activeRoot.on('value', handler, error => {
        status.textContent = error?.message || 'Could not load conversation.';
      });
      stopThread = () => activeRoot?.off('value', handler);
    }

    const listHandler = snapshot => {
      if (!isCurrent()) return;
      tickets.replaceChildren();
      const items = [];
      snapshot.forEach(child => items.push({ id: child.key, ...child.val() }));
      items.sort((a,b) => Number(b.updatedAt || b.createdAt || 0) -
        Number(a.updatedAt || a.createdAt || 0));
      if (!items.length) tickets.append(el('p', 'member-note', 'No conversations yet. Send a support ticket above.'));
      items.forEach(ticket => {
        const button = el('button', 'member-primary member-secondary-support',
          (ticket.subject || 'Support') + ' · ' + (ticket.status || 'open'));
        button.type = 'button';
        button.onclick = () => openTicket(ticket.id);
        tickets.append(button);
      });
      if (activeRoot && !items.some(item => item.id === activeRoot.key)) {
        stopThread?.();
        activeRoot = null;
        thread.replaceChildren();
        replyForm.hidden = true;
      }
    };
    query.on('value', listHandler, error => {
      tickets.replaceChildren(el('p', 'member-note', error?.message || 'Cannot load support conversations.'));
    });
    stopList = () => query.off('value', listHandler);
    refreshList = () => query.once('value').then(listHandler);

    replyForm.onsubmit = async event => {
      event.preventDefault();
      const message = replyBox.value.trim();
      if (!activeRoot || message.length < 2 || message.length > 1500) return;
      send.disabled = true;
      status.textContent = 'Sending reply…';
      try {
        await activeRoot.child('messages').push().set({
          text: message, senderUid: user.uid,
          senderRole: role === 'driver' ? 'driver' : 'passenger',
          createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        replyBox.value = '';
        status.textContent = 'Reply sent to Asiye Support.';
      } catch (error) {
        status.textContent = error?.message || 'Reply could not be sent.';
      } finally {
        send.disabled = false;
      }
    };
    dialog?.addEventListener?.('close', cleanup, { once: true });
  }

  window.AsiyeSupportChat = { mount, reload: () => refreshList(), cleanup };
})();
