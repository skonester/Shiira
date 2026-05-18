let passwords = [];
let editingId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadPasswords();
    setupEventListeners();
    initTextContextMenu();
});

function setupEventListeners() {
    document.getElementById('add-btn').addEventListener('click', () => openModal());
    document.getElementById('import-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal());
    document.getElementById('save-btn').addEventListener('click', () => savePassword());
    document.getElementById('search').addEventListener('input', (e) => filterPasswords(e.target.value));
    document.getElementById('file-input').addEventListener('change', (e) => importCSV(e.target.files[0]));
    
    // Close modal on overlay click
    document.getElementById('password-modal').addEventListener('click', (e) => {
        if (e.target.id === 'password-modal') {
            closeModal();
        }
    });
    
    // Global click listener to close context menu when clicking outside
    document.addEventListener('click', (e) => {
        if (textContextMenu && 
            !textContextMenu.classList.contains('hidden') &&
            !textContextMenu.contains(e.target)) {
            hideTextContextMenu();
        }
    });
}

async function loadPasswords() {
    const result = await window.electronAPI.passwords.getAll();
    passwords = result;
    renderPasswords(passwords);
}

function renderPasswords(passwordList) {
    const container = document.getElementById('passwords-list');
    
    if (passwordList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔐</div>
                <div class="empty-state-text">No passwords saved yet</div>
                <div class="empty-state-subtext">Add your first password or import from Chrome</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = passwordList.map(pwd => `
        <div class="password-item">
            <div class="password-info">
                <div class="password-url">${escapeHtml(pwd.url)}</div>
                <div class="password-username">${escapeHtml(pwd.username)}</div>
            </div>
            <div class="password-actions">
                <button class="icon-btn" onclick="copyPassword(${pwd.id})">Copy</button>
                <button class="icon-btn" onclick="editPassword(${pwd.id})">Edit</button>
                <button class="icon-btn delete" onclick="deletePassword(${pwd.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

function filterPasswords(query) {
    const filtered = passwords.filter(pwd => 
        pwd.url.toLowerCase().includes(query.toLowerCase()) ||
        pwd.username.toLowerCase().includes(query.toLowerCase())
    );
    renderPasswords(filtered);
}

function openModal(password = null) {
    const modal = document.getElementById('password-modal');
    const title = document.getElementById('modal-title');
    
    if (password) {
        title.textContent = 'Edit Password';
        document.getElementById('url-input').value = password.url;
        document.getElementById('username-input').value = password.username;
        document.getElementById('password-input').value = password.password;
        editingId = password.id;
    } else {
        title.textContent = 'Add Password';
        document.getElementById('url-input').value = '';
        document.getElementById('username-input').value = '';
        document.getElementById('password-input').value = '';
        editingId = null;
    }
    
    modal.classList.add('show');
}

function closeModal() {
    document.getElementById('password-modal').classList.remove('show');
    editingId = null;
}

async function savePassword() {
    const url = document.getElementById('url-input').value.trim();
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value;
    
    if (!url || !username || !password) {
        alert('Please fill in all fields');
        return;
    }
    
    // Security: URL validation
    const urlPattern = /^(https?:\/\/)?[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]*$/;
    if (!urlPattern.test(url)) {
        alert('Please enter a valid URL (e.g., https://example.com)');
        return;
    }
    
    // Security: Block dangerous URL schemes
    const urlLower = url.toLowerCase();
    if (urlLower.startsWith('javascript:') || urlLower.startsWith('data:') || 
        urlLower.startsWith('file:') || urlLower.startsWith('about:')) {
        alert('Invalid URL scheme. Please use http:// or https://');
        return;
    }
    
    // Security: Password strength check (minimum 8 characters recommended)
    if (password.length < 8) {
        const proceed = confirm('Warning: Password is less than 8 characters. This is not recommended for security. Continue anyway?');
        if (!proceed) {
            return;
        }
    }
    
    if (editingId) {
        await window.electronAPI.passwords.update(editingId, url, username, password);
    } else {
        await window.electronAPI.passwords.add(url, username, password);
    }
    
    closeModal();
    loadPasswords();
}

async function editPassword(id) {
    const password = passwords.find(p => p.id === id);
    if (password) {
        openModal(password);
    }
}

async function deletePassword(id) {
    if (confirm('Are you sure you want to delete this password?')) {
        await window.electronAPI.passwords.delete(id);
        loadPasswords();
    }
}

async function copyPassword(id) {
    const password = passwords.find(p => p.id === id);
    if (password) {
        await navigator.clipboard.writeText(password.password);
        
        // Show feedback
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#4CAF50';
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }
}

async function importCSV(file) {
    if (!file) return;
    
    // Security: Check file size (1MB max)
    const MAX_SIZE = 1024 * 1024; // 1MB
    if (file.size > MAX_SIZE) {
        alert('CSV file is too large. Maximum size is 1MB.');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;
        const result = await window.electronAPI.passwords.importCSV(csvData);
        
        alert(`Import complete!\nImported: ${result.imported}\nErrors: ${result.errors}`);
        loadPasswords();
    };
    reader.readAsText(file);
    
    // Reset file input
    document.getElementById('file-input').value = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Text Context Menu =====
let textContextMenu = null;
let textContextTarget = null;

function initTextContextMenu() {
    textContextMenu = document.getElementById('text-context-menu');
    if (!textContextMenu) return;
    
    // Bind context menu to modal inputs
    const inputs = ['url-input', 'username-input', 'password-input', 'search'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showTextContextMenu(e, input);
            });
        }
    });
    
    // Handle menu item clicks
    textContextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from reaching modal
            const action = item.dataset.action;
            handleTextContextAction(action);
        });
    });
    
    // Prevent context menu from closing when clicking inside it
    textContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    textContextMenu.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    textContextMenu.addEventListener('mouseup', (e) => {
        e.stopPropagation();
    });
}

function showTextContextMenu(e, inputElement) {
    textContextTarget = inputElement;
    updateTextContextMenuState(inputElement);
    
    textContextMenu.classList.remove('hidden');
    
    // Position menu
    let x = e.clientX;
    let y = e.clientY;
    
    const menuRect = textContextMenu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    if (x + menuRect.width > windowWidth) {
        x = windowWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > windowHeight) {
        y = windowHeight - menuRect.height - 10;
    }
    
    textContextMenu.style.left = `${x}px`;
    textContextMenu.style.top = `${y}px`;
}

function hideTextContextMenu() {
    if (textContextMenu) {
        textContextMenu.classList.add('hidden');
    }
    textContextTarget = null;
}

function updateTextContextMenuState(inputElement) {
    const hasSelection = inputElement.selectionStart !== inputElement.selectionEnd;
    const hasText = inputElement.value.length > 0;
    
    const cutItem = textContextMenu.querySelector('[data-action="cut"]');
    const copyItem = textContextMenu.querySelector('[data-action="copy"]');
    const deleteItem = textContextMenu.querySelector('[data-action="delete"]');
    const selectAllItem = textContextMenu.querySelector('[data-action="select-all"]');
    
    if (cutItem) cutItem.classList.toggle('disabled', !hasSelection);
    if (copyItem) copyItem.classList.toggle('disabled', !hasSelection);
    if (deleteItem) deleteItem.classList.toggle('disabled', !hasSelection);
    if (selectAllItem) selectAllItem.classList.toggle('disabled', !hasText);
}

async function handleTextContextAction(action) {
    const input = textContextTarget;
    if (!input) {
        hideTextContextMenu();
        return;
    }
    
    input.focus();
    
    switch (action) {
        case 'undo':
            document.execCommand('undo');
            break;
        case 'redo':
            document.execCommand('redo');
            break;
        case 'cut':
            if (input.selectionStart !== input.selectionEnd) {
                const selectedText = input.value.substring(input.selectionStart, input.selectionEnd);
                await navigator.clipboard.writeText(selectedText);
                document.execCommand('delete');
            }
            break;
        case 'copy':
            if (input.selectionStart !== input.selectionEnd) {
                const selectedText = input.value.substring(input.selectionStart, input.selectionEnd);
                await navigator.clipboard.writeText(selectedText);
            }
            break;
        case 'paste':
            try {
                const text = await navigator.clipboard.readText();
                document.execCommand('insertText', false, text);
            } catch (err) {
                console.error('[TextContextMenu] Paste failed:', err);
            }
            break;
        case 'delete':
            if (input.selectionStart !== input.selectionEnd) {
                document.execCommand('delete');
            }
            break;
        case 'select-all':
            input.select();
            break;
    }
    
    hideTextContextMenu();
}
