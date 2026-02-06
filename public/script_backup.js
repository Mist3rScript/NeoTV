const app = {
    api: '/api',
    state: {
        activeTab: 'dashboard'
    },
    curPage: 1,

    init: () => {
        app.loadStats();
        app.loadKeys();
        app.loadAccounts();
        app.loadChannels();
        app.loadNotifications(); // New
        app.initCharts();

        // Poll notifications every 60s
        setInterval(app.loadNotifications, 60000);
    },

    toggleNotifications: () => {
        document.getElementById('notif-dropdown').classList.toggle('hidden');
    },

    loadNotifications: async () => {
        try {
            const resp = await fetch(`${app.api}/admin/notifications`);
            const list = await resp.json();

            const dropdown = document.getElementById('notif-list');
            const badge = document.getElementById('notif-badge');

            // Count unread
            const unread = list.filter(n => !n.read).length;
            if (unread > 0) {
                badge.innerText = unread;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }

            if (list.length === 0) {
                dropdown.innerHTML = '<div class="notif-item placeholder">No notifications</div>';
                return;
            }

            dropdown.innerHTML = list.map(n => `
                <div class="notif-item ${n.read ? '' : 'unread'}">
                    <div class="notif-msg">${n.message}</div>
                    <div class="notif-time">${new Date(n.created_at).toLocaleTimeString()}</div>
                </div>
            `).join('');

        } catch (e) { console.error('Notif error', e); }
    },

    markRead: async () => {
        await fetch(`${app.api}/admin/notifications/mark-read`, { method: 'POST' });
        app.loadNotifications();
    },

    openEditChannel: (channel) => {
        document.getElementById('editChId').value = channel.id;
        document.getElementById('editChName').value = channel.name;

        const container = document.getElementById('streams-container');
        if (channel.streams && channel.streams.length > 0) {
            container.innerHTML = channel.streams.map((s, idx) => {
                const isPrimary = idx === 0;
                const providerType = s.provider_id ? 'xtream' : 'manual'; // Simple detection
                const providerName = s.provider_id ? `Provider #${s.provider_id}` : 'Manual';

                return `
                <div class="stream-card ${isPrimary ? 'primary' : 'backup'}">
                    <div class="stream-icon ${providerType}">
                        <i class="fas fa-${providerType === 'manual' ? 'link' : 'broadcast-tower'}"></i>
                    </div>
                    <div class="stream-info">
                        <div class="stream-url">${s.stream_url}</div>
                        <div class="stream-meta">
                            <span class="stream-badge ${isPrimary ? 'primary' : 'backup'}">${isPrimary ? 'Primary' : 'Backup #' + idx}</span>
                            <span class="stream-badge provider">${providerName}</span>
                        </div>
                    </div>
                    <div class="stream-actions">
                        ${!isPrimary ? `<button class="btn-stream" onclick="app.setStreamPrimary(${channel.id}, ${s.id})"><i class="fas fa-star"></i> Set Primary</button>` : ''}
                        <button class="btn-stream danger" onclick="app.deleteStream(${s.id})"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                `;
            }).join('');
        } else {
            container.innerHTML = '<div style="text-align:center; color:#666; padding:20px; font-style:italic">No streams attached yet. Add one below!</div>';
        }

        app.modal.open('editChannelModal');
    },

    openCatalogBrowser: async () => {
        const channelName = document.getElementById('editChName').value;
        const channelId = document.getElementById('editChId').value;

        // Store for later
        window.currentEditingChannelId = channelId;

        document.getElementById('catBrowseQuery').innerText = channelName;

        try {
            const resp = await fetch(`${app.api}/admin/catalog?q=${encodeURIComponent(channelName)}&limit=50`);
            const results = await resp.json();

            const container = document.getElementById('catalogBrowserResults');

            if (results.length === 0) {
                container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#666;">No matching streams found in Catalog</div>';
                app.modal.open('catalogBrowserModal');
                return;
            }

            container.innerHTML = results.map(item => `
                <div class="catalog-card" onclick="app.toggleCatalogSelect(this, ${item.id})" data-catalog-id="${item.id}" data-stream-url="${item.stream_url}" data-provider-id="${item.account_id}">
                    <div class="catalog-card-header">
                        <div class="catalog-checkbox">
                            <i class="fas fa-circle"></i>
                        </div>
                        <div class="catalog-provider">Provider #${item.account_id}</div>
                    </div>
                    <div class="catalog-card-body">
                        <div class="catalog-name">${item.name}</div>
                        <div class="catalog-url">${item.stream_url.substring(0, 60)}...</div>
                    </div>
                </div>
            `).join('');

            app.modal.open('catalogBrowserModal');
            app.updateCatalogCount();

        } catch (e) { alert('Error loading catalog: ' + e.message); }
    },

    toggleCatalogSelect: (card, id) => {
        card.classList.toggle('selected');
        app.updateCatalogCount();
    },

    updateCatalogCount: () => {
        const selected = document.querySelectorAll('.catalog-card.selected').length;
        document.getElementById('catBrowseCount').innerText = `${selected} selected`;
    },

    addSelectedFromCatalog: async () => {
        const selected = document.querySelectorAll('.catalog-card.selected');
        if (selected.length === 0) { alert('Please select at least one stream'); return; }

        const channelId = window.currentEditingChannelId;
        let added = 0;

        for (const card of selected) {
            const streamUrl = card.dataset.streamUrl;
            const providerId = card.dataset.providerId;

            try {
                await fetch(`${app.api}/admin/channels/${channelId}/streams`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ streamUrl, providerId })
                });
                added++;
            } catch (e) { console.error(e); }
        }

        alert(`Added ${added} stream(s) successfully!`);
        app.modal.close('catalogBrowserModal');

        // Reload edit modal
        const ch = await app.getChannelById(channelId);
        app.openEditChannel(ch);
    },

    getChannelById: async (id) => {
        const resp = await fetch(`${app.api}/admin/channels?page=1&limit=1000`); // Hacky, but works for now
        const data = await resp.json();
        return data.data.find(c => c.id == id);
    },

    setStreamPrimary: async (channelId, streamId) => {
        // For now, just inform user (real implementation would update priority in DB)
        alert('Set as Primary feature: Coming soon! (Requires priority update in backend)');
    },

    deleteStream: async (streamId) => {
        if (!confirm('Delete this stream?')) return;
        // Need to add DELETE endpoint in backend
        alert('Delete Stream: Backend endpoint needed. Add: DELETE /api/admin/streams/:id');
    },

    addStreamToChannel: async () => {
        const id = document.getElementById('editChId').value;
        const url = document.getElementById('newStreamUrl').value;

        if (!url) { alert('Please paste a stream URL'); return; }

        try {
            const resp = await fetch(`${app.api}/admin/channels/${id}/streams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ streamUrl: url })
            });
            if (resp.ok) {
                alert('Stream Added Successfully!');
                document.getElementById('newStreamUrl').value = '';
                // Reload channel and refresh modal
                const ch = await app.getChannelById(id);
                app.openEditChannel(ch);
            } else { alert('Error adding stream'); }
        } catch (e) { alert('Network error: ' + e.message); }
    },

    saveChannelName: async () => {
        const id = document.getElementById('editChId').value;
        const newName = document.getElementById('editChName').value;

        if (!newName) { alert('Name cannot be empty'); return; }

        try {
            const resp = await fetch(`${app.api}/admin/channels/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            if (resp.ok) {
                alert('Channel name updated!');
                app.loadChannels();
            } else { alert('Error updating name'); }
        } catch (e) { alert('Error: ' + e.message); }
    },

    navigate: (tabId) => {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
        if (navItem) navItem.classList.add('active');

        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${tabId}`).classList.add('active');

        const titleMap = {
            'dashboard': 'Dashboard Overview',
            'keys': 'Activation Keys',
            'accounts': 'External Sources',
            'channels': 'Channel Management',
            'settings': 'System Settings'
        };
        document.getElementById('page-title').innerText = titleMap[tabId] || 'Dashboard';
    },

    modal: {
        open: (id) => {
            document.getElementById(id).classList.add('open');
        },
        close: (id) => {
            document.getElementById(id).classList.remove('open');
        }
    },

    toggleAccountFields: () => {
        const type = document.getElementById('accType').value;
        if (type === 'm3u') {
            document.getElementById('field-userpass').classList.remove('hidden');
            document.getElementById('field-mac').classList.add('hidden');
        } else {
            document.getElementById('field-userpass').classList.add('hidden');
            document.getElementById('field-mac').classList.remove('hidden');
        }
    },

    createAccount: async () => {
        const type = document.getElementById('accType').value;
        const host = document.getElementById('accHost').value;
        const username = document.getElementById('accUser').value;
        const password = document.getElementById('accPass').value;
        const mac = document.getElementById('accMac').value;
        const durationDays = document.getElementById('accDuration').value;

        if (!host) { alert('Host URL required'); return; }

        try {
            const response = await fetch(`${app.api}/admin/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, host, username, password, mac, durationDays, adminPassword: 'admin' })
            });
            if (response.ok) {
                app.modal.close('createAccountModal');
                app.loadAccounts();
                app.loadStats();
                document.getElementById('accHost').value = '';
                document.getElementById('accUser').value = '';
                document.getElementById('accPass').value = '';
                document.getElementById('accMac').value = '';
            } else {
                alert('Failed. Check credentials or unique attributes.');
            }
        } catch (e) { alert('Server error'); }
    },

    loadAccounts: async () => {
        try {
            const response = await fetch(`${app.api}/admin/accounts`);
            const accounts = await response.json();
            const tbody = document.getElementById('accounts-table-body');

            tbody.innerHTML = accounts.map(a => {
                const typeColor = a.type === 'm3u' ? '#667eea' : '#f093fb';
                const typeGradient = a.type === 'm3u' ?
                    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' :
                    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';

                return `
                <tr class="channel-row">
                    <td>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="width:45px; height:45px; border-radius:8px; background:${typeGradient}; display:flex; align-items:center; justify-content:center; font-size:1.2rem; color:white;">
                                <i class="fas fa-${a.type === 'm3u' ? 'broadcast-tower' : 'satellite-dish'}"></i>
                            </div>
                            <div>
                                <div class="stream-badge provider" style="font-size:0.75rem; text-transform:uppercase; display:inline-block;">
                                    ${a.type.toUpperCase()}
                                </div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="font-size:0.9rem; font-weight:500; color:var(--primary);">${a.host_url || '-'}</div>
                    </td>
                    <td style="font-size:0.85rem;">
                        ${a.type === 'm3u' ?
                        `<span style="color:#aaa;">${a.username}</span>` :
                        `<span style="font-family:monospace; color:#aaa;">${a.mac_address}</span>`
                    }
                    </td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-stream" onclick="app.syncAccount(${a.id})" style="background:rgba(16, 185, 129, 0.1); border-color:#10b981; color:#10b981;">
                                <i class="fas fa-sync"></i> Sync
                            </button>
                            <button class="btn-stream" onclick="app.checkAccount(${a.id}, this)" style="background:rgba(251, 191, 36, 0.1); border-color:#fbbf24; color:#fbbf24;">
                                <i class="fas fa-stethoscope"></i> Check
                            </button>
                        </div>
                    </td>
                    <td>
                        <button class="btn-stream danger" onclick="app.deleteAccount(${a.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
                `;
            }).join('');
        } catch (e) { console.error(e); }
    },

    checkAccount: async (id, btn) => {
        const origText = btn.innerHTML;
        btn.innerHTML = '...';

        try {
            const response = await fetch(`${app.api}/admin/accounts/${id}/check`, { method: 'POST' });
            const data = await response.json();

            if (data.status === 'DEAD') {
                alert(`Account is DEAD! It was deleted automatically.\nReason: ${data.message}`);
                app.loadAccounts();
                app.loadChannels();
                app.loadStats();
            } else if (data.status === 'ALIVE') {
                alert('Account is ACTIVE and working OK.');
            } else {
                alert('Connection Problem (Not dead): ' + data.message);
            }
        } catch (e) { alert('Network error'); }
        btn.innerHTML = origText;
    },

    syncAccount: async (id) => {
        if (!confirm('Start channel sync from this source?')) return;
        try {
            alert('Sync started... please wait.');
            const response = await fetch(`${app.api}/admin/accounts/${id}/sync`, { method: 'POST' });
            const data = await response.json();

            if (response.ok) {
                alert(`Sync Complete! Imported ${data.imported} new channels (Total found: ${data.total}).`);
                app.loadStats();
                app.loadChannels();
            } else {
                alert('Sync Failed: ' + data.error);
            }
        } catch (e) { alert('Network error during sync'); }
    },

    deleteAccount: async (id) => {
        if (!confirm('Delete this source? All associated channels will be deleted automatically.')) return;
        try {
            await fetch(`${app.api}/admin/accounts/${id}`, { method: 'DELETE' });
            app.loadAccounts();
            app.loadChannels();
            app.loadStats();
        } catch (e) { alert('Error deleting account'); }
    },

    // ... (Existing Pagination) ...

    openCatalog: async () => {
        // Load sources for dropdown
        try {
            const resp = await fetch(`${app.api}/admin/accounts`);
            const accounts = await resp.json();
            document.getElementById('catSource').innerHTML =
                '<option value="">All Sources</option>' +
                accounts.map(a => `<option value="${a.id}">${a.host_url} (${a.type})</option>`).join('');

            app.modal.open('catalogModal');
            app.loadCatalog();
        } catch (e) { alert('Error loading sources'); }
    },

    catTimeout: null,
    loadCatalogDelayed: () => {
        clearTimeout(app.catTimeout);
        app.catTimeout = setTimeout(app.loadCatalog, 500);
    },

    loadCatalog: async () => {
        const source = document.getElementById('catSource').value;
        const q = document.getElementById('catSearch').value;
        const tbody = document.getElementById('catalog-table-body');

        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#666">Loading...</td></tr>';

        try {
            const params = new URLSearchParams({ limit: 500 }); // Increased limit
            if (source) params.append('source', source);
            if (q) params.append('q', q);

            const resp = await fetch(`${app.api}/admin/catalog?${params.toString()}`);
            const data = await resp.json();

            console.log(`[Catalog] Search: "${q}" | Results: ${data.length}`);

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#666">No channels found in Catalog. Did you Sync your providers?</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(item => `
                <tr>
                    <td><input type="checkbox" class="cat-check" value="${item.id}" onchange="app.updateSelectCount()"></td>
                    <td>${item.name}</td>
                    <td style="color:#aaa; font-size:0.8rem">${item.category}</td>
                    <td><span class="status-badge" style="background:#222">${item.logo_url ? 'Img' : 'Txt'}</span></td>
                </tr>
            `).join('');
            app.updateSelectCount();

        } catch (e) {
            console.error('[Catalog] Error:', e);
            tbody.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center">Error: ${e.message}</td></tr>`;
        }
    },

    toggleSelectAll: (cb) => {
        document.querySelectorAll('.cat-check').forEach(c => c.checked = cb.checked);
        app.updateSelectCount();
    },

    updateSelectCount: () => {
        const count = document.querySelectorAll('.cat-check:checked').length;
        document.getElementById('select-count').innerText = `${count} Selected`;
    },

    curateChannels: async () => {
        const checked = Array.from(document.querySelectorAll('.cat-check:checked')).map(c => c.value);
        const targetCat = document.getElementById('targetCategory').value;

        if (checked.length === 0) { alert('Select at least one channel'); return; }
        if (!targetCat) { alert('Please enter a Target List Name (e.g. Sports)'); return; }

        try {
            const resp = await fetch(`${app.api}/admin/channels/curate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemIds: checked, category: targetCat, adminPassword: 'admin' })
            });
            const data = await resp.json();
            if (resp.ok) {
                app.modal.close('catalogModal');
                // Navigate to page 1 and reload
                app.curPage = 1;
                await app.loadChannels(1);
                app.loadStats();
                // Show success message
                const notification = document.createElement('div');
                notification.style.cssText = 'position:fixed; top:80px; right:20px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:white; padding:15px 25px; border-radius:8px; box-shadow:0 4px 12px rgba(16, 185, 129, 0.3); z-index:9999; font-weight:600;';
                notification.innerHTML = `<i class="fas fa-check-circle"></i> Successfully added ${data.count} channels to "${targetCat}"`;
                document.body.appendChild(notification);
                setTimeout(() => notification.remove(), 3000);
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) { alert('Network Error'); }
    },

    changePage: (dir) => {
        app.curPage += dir;
        app.loadChannels(app.curPage);
    },

    filterChannels: () => {
        const query = document.getElementById('channelSearch').value.toLowerCase();
        const rows = document.querySelectorAll('#channels-table-body .channel-row');

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(query) ? '' : 'none';
        });
    },

    loadChannels: async (page = 1) => {
        app.curPage = page;
        try {
            const response = await fetch(`${app.api}/admin/channels?page=1&limit=10000`);
            const data = await response.json();

            const container = document.getElementById('channels-folder-view');

            if (!container) {
                console.error('Container not found!');
                return;
            }

            if (!data.data || data.data.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">No channels yet!</div>';
                return;
            }

            // Group by category
            const grouped = {};
            data.data.forEach(ch => {
                const cat = ch.category || 'Uncategorized';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(ch);
            });

            // Render folders  
            container.innerHTML = Object.keys(grouped).sort().map(category => {
                const channels = grouped[category];
                const folderId = 'folder-' + category.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');

                return `
                    <div>
                        <div class="folder-item" onclick="app.toggleFolder('${folderId}')">
                            <i class="fas fa-folder folder-icon"></i>
                            <span class="folder-name">${category}</span>
                            <span class="folder-count">${channels.length} channels</span>
                            <i class="fas fa-chevron-right folder-toggle"></i>
                        </div>
                        <div class="folder-channels" id="${folderId}">
                            ${channels.map(c => `
                                <div class="channel-item">
                                    <div class="channel-logo">
                                        ${c.logo_url ? `<img src="${c.logo_url}">` : `<i class="fas fa-tv" style="font-size:1.2rem; color:#444;"></i>`}
                                    </div>
                                    <div class="channel-info">
                                        <div class="channel-name">${c.name}</div>
                                        <div class="channel-url">${c.stream_url || ''}</div>
                                    </div>
                                    <div class="channel-actions">
                                        <button class="btn-stream" onclick='app.openEditChannel(${JSON.stringify(c).replace(/'/g, "&#39;")})'><i class="fas fa-edit"></i></button>
                                        <button class="btn-stream danger" onclick="app.deleteChannel(${c.id})"><i class="fas fa-trash"></i></button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('');

            generateKey: async () => {
                const password = document.getElementById('keyAdminPass').value;
                const duration = document.getElementById('keyDuration').value;
                const display = document.getElementById('new-key-display');
                const keyText = document.getElementById('generatedKeyDisplay');

                if (!password) {
                    alert('Admin password required');
                    return;
                }

                try {
                    const response = await fetch(`${app.api} /admin/create - key`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password, durationDays: duration })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        keyText.innerText = data.key;
                        display.classList.remove('hidden');
                        app.loadKeys();
                        app.loadStats();
                    } else {
                        alert(data.error);
                    }
                } catch (e) {
                    alert('Error connecting to server');
                }
            },
                // ... loadKeys, addChannel, loadStats ...
                loadKeys: async () => {
                    try {
                        const response = await fetch(`${app.api} /admin/keys`);
                        const keys = await response.json();

                        const tbody = document.getElementById('keys-table-body');
                        tbody.innerHTML = keys.map(k => {
                            const statusClass = k.is_active ? 'status-active' : 'status-inactive';
                            const statusColor = k.is_active ? '#10b981' : '#ef4444';
                            const isUsed = k.device_id !== null;

                            return `
    < tr class="channel-row" >
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); display:flex; align-items:center; justify-content:center; font-size:1.2rem; color:white;">
                            <i class="fas fa-key"></i>
                        </div>
                        <span class="key-code" style="font-size:1rem; font-weight:600;">${k.key_code}</span>
                    </div>
                </td>
                <td>
                    <span class="stream-badge ${k.is_active ? 'primary' : 'backup'}" style="background:${statusColor}20; color:${statusColor}; border:1px solid ${statusColor};">
                        ${k.is_active ? '✓ Active' : '✗ Inactive'}
                    </span>
                </td>
                <td>
                    <span class="stream-badge provider">${k.duration_days} Days</span>
                </td>
                <td>
                    ${isUsed ?
                                    `<span style="font-family:monospace; color:var(--primary); font-size:0.85rem;">${k.device_id}</span>` :
                                    `<span style="color:#666; font-style:italic; font-size:0.85rem;">Not activated yet</span>`
                                }
                </td>
                <td style="color:var(--text-muted); font-size:0.85rem;">
                    ${k.expiration_date ? new Date(k.expiration_date).toLocaleDateString() : '-'}
                </td>
                <td>
                    <button class="btn-stream danger" onclick="app.deleteKey(${k.id})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
    `;
                        }).join('');

                    } catch (e) { console.error(e); }
                },

                    addChannel: async () => {
                        const password = document.getElementById('channelAdminPass').value;
                        const name = document.getElementById('channelName').value;
                        const streamUrl = document.getElementById('streamUrl').value;
                        const logoUrl = document.getElementById('logoUrl').value;

                        if (!password || !name || !streamUrl) {
                            alert('Please fill all fields');
                            return;
                        }

                        try {
                            const response = await fetch(`${app.api} /admin/add - channel`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ password, name, streamUrl, logoUrl })
                            });

                            if (response.ok) {
                                app.modal.close('addChannelModal');
                                app.loadChannels();
                                app.loadStats(); // Update stats
                                document.getElementById('channelName').value = '';
                                document.getElementById('streamUrl').value = '';
                            } else {
                                alert('Failed to add channel');
                            }
                        } catch (e) {
                            alert('Error connecting to server');
                        }
                    },

                        deleteKey: async (id) => {
                            if (!confirm('Are you sure you want to delete this key?')) return;
                            try {
                                await fetch(`${app.api} /admin/keys / ${id} `, { method: 'DELETE' });
                                app.loadKeys();
                                app.loadStats();
                            } catch (e) { alert('Error deleting key'); }
                        },

                            deleteChannel: async (id) => {
                                if (!confirm('Are you sure you want to delete this channel?')) return;
                                try {
                                    await fetch(`${app.api} /admin/channels / ${id} `, { method: 'DELETE' });
                                    app.loadChannels();
                                    app.loadStats();
                                } catch (e) { alert('Error deleting channel'); }
                            },

                                loadStats: async () => {
                                    try {
                                        const response = await fetch(`${app.api} /admin/stats`);
                                        const stats = await response.json();

                                        const cards = document.querySelectorAll('.stat-value');
                                        if (cards[0]) cards[0].innerText = stats.users || 0;
                                        if (cards[1]) cards[1].innerText = parseInt(stats.keys || 0) + parseInt(stats.accounts || 0);
                                        if (cards[2]) cards[2].innerText = stats.channels || 0;

                                    } catch (e) { console.error('Stats load error', e); }
                                },

                                    initCharts: () => {
                                        const ctx = document.getElementById('usageChart').getContext('2d');
                                        new Chart(ctx, {
                                            type: 'line',
                                            data: {
                                                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                                                datasets: [{
                                                    label: 'New Activations',
                                                    data: [12, 19, 3, 5, 2, 3, 10],
                                                    borderColor: '#00f3ff', // Cyan
                                                    tension: 0.4,
                                                    fill: true,
                                                    backgroundColor: 'rgba(0, 243, 255, 0.1)'
                                                }]
                                            },
                                            options: {
                                                responsive: true,
                                                maintainAspectRatio: false,
                                                plugins: { legend: { display: false } },
                                                scales: {
                                                    y: { beginAtZero: true, grid: { color: '#1a1a1a' } },
                                                    x: { grid: { display: false } }
                                                }
                                            }
                                        });
                                    }
        };

        document.addEventListener('DOMContentLoaded', app.init);
